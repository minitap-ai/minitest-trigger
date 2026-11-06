import * as core from '@actions/core'
import type { CiTargetStatus, Platform } from './api'
import { targetLabel, type LabelledTarget } from './targets'

export interface TargetRow {
  label: string
  platform: Platform
  status: string
  criticals: number
  warnings: number
}

const PLATFORM_NAMES: Record<Platform, string> = {
  ios: 'iOS',
  android: 'Android',
  web: 'Web',
}

export function requestedRows(targets: LabelledTarget[]): TargetRow[] {
  return targets.map((target) => ({
    label: targetLabel(target),
    platform: target.platform,
    status: 'queued',
    criticals: 0,
    warnings: 0,
  }))
}

export function resultRows(targets: CiTargetStatus[]): TargetRow[] {
  return targets.map((target) => ({
    label: targetLabel(target),
    platform: target.platform,
    status: target.status ?? 'pending',
    criticals: target.criticals,
    warnings: target.warnings,
  }))
}

/** "iOS: 2 critical · 1 warning", one line per platform that has targets. */
export function platformTotals(rows: TargetRow[]): string[] {
  const platforms = [...new Set(rows.map((row) => row.platform))]
  return platforms.map((platform) => {
    const own = rows.filter((row) => row.platform === platform)
    const criticals = own.reduce((sum, row) => sum + row.criticals, 0)
    const warnings = own.reduce((sum, row) => sum + row.warnings, 0)
    return `${PLATFORM_NAMES[platform]}: ${criticals} critical · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
  })
}

/** Writes the `targets` output and the job summary table, one row per target. */
export async function reportTargets(
  rows: TargetRow[],
  url: string | null,
): Promise<void> {
  core.setOutput('targets', JSON.stringify(rows))
  if (!rows.length) return
  for (const row of rows) {
    core.info(
      `  ${row.label}: ${row.status} (${row.criticals} critical · ${row.warnings} warnings)`,
    )
  }
  const summary = core.summary
    .addHeading('Minitest run', 3)
    .addTable([
      [
        { data: 'Target', header: true },
        { data: 'Status', header: true },
        { data: 'Critical', header: true },
        { data: 'Warnings', header: true },
      ],
      ...rows.map((row) => [
        row.label,
        row.status,
        String(row.criticals),
        String(row.warnings),
      ]),
    ])
    .addList(platformTotals(rows))
  if (url) summary.addLink('Open the run in Minitest', url)
  if (process.env.GITHUB_STEP_SUMMARY) await summary.write()
}
