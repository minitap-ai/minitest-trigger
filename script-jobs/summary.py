"""Turn the JSON verdict of `minitest script-runs submit` into step outputs and a job summary.

Usage: summary.py <verdict.json> <cli exit code>. Writes to $GITHUB_OUTPUT and
$GITHUB_STEP_SUMMARY and prints the per-test results to the log.
"""

import json
import os
import sys

ICONS = {"passed": "✅", "failed": "❌", "error": "⚠️", "skipped": "⏭️"}


def _cell(text: str | None) -> str:
    return (text or "").replace("|", "\\|").replace("\n", " ")[:300]


def _rows(job: dict) -> list[tuple[str, str, str, str]]:
    rows = []
    for unit in job.get("units", []):
        issue = unit.get("infraDetail") or unit.get("infraOutcome")
        cases = unit.get("cases") or []
        if not cases:
            rows.append((unit["unit"], "", unit["state"], issue or ""))
        for case in cases:
            failure = case.get("failureMessage") or case.get("errorMessage")
            rows.append((unit["unit"], case.get("name", ""), case.get("status", ""), failure or ""))
    return rows


def render(job: dict | None, code: int) -> tuple[dict[str, str], str, str]:
    """Return the outputs, the markdown summary and the log text."""
    if job is None:
        reason = (
            "Minitap could not run the job or the wait timed out"
            if code == 7
            else "the job could not be submitted"
        )
        text = f"No verdict: {reason} (exit {code}). See the step log."
        return {"status": "error"}, f"### Minitest script run\n\n{text}\n", text
    status = job.get("status", "error")
    if status not in ("passed", "failed"):
        status = "error"
    outputs = {"job-id": job.get("jobId", ""), "run-url": job.get("runUrl", ""), "status": status}
    rows = _rows(job)
    head = f"### {ICONS.get(status, '')} {job.get('runName') or 'Minitest script run'}: {status}"
    lines = [head, "", f"{job.get('framework')} on {job.get('platform')}, {len(rows)} test(s)."]
    if code == 7:
        lines += ["", "Minitap could not run some tests; they are not counted as failures."]
    lines += ["", "| Flow / class | Test | Status | Failure |", "| --- | --- | --- | --- |"]
    for unit, name, state, failure in rows:
        icon = ICONS.get(state, "")
        lines.append(f"| {_cell(unit)} | {_cell(name)} | {icon} {state} | {_cell(failure)} |")
    lines += ["", f"[Open the run in Minitest]({outputs['run-url']})"]
    log = "\n".join(
        [f"{state:8} {unit} {name} {failure}".rstrip() for unit, name, state, failure in rows]
        + [f"Run: {outputs['run-url']}"]
    )
    return outputs, "\n".join(lines) + "\n", log


def main() -> None:
    path, code = sys.argv[1], int(sys.argv[2])
    try:
        with open(path) as f:
            job = json.load(f)
    except (OSError, ValueError):
        job = None
    outputs, summary, log = render(job, code)
    print(log)
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.writelines(f"{key}={value}\n" for key, value in outputs.items())
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
        f.write(summary)


if __name__ == "__main__":
    main()
