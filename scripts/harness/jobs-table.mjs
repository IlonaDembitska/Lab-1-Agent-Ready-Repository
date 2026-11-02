// Usage: node scripts/harness/jobs-table.mjs <runId> [<runId> ...]
// Prints a markdown table of jobs (gate, result, seconds) for each Actions run.
const repo = 'IlonaDembitska/Lab-1-Agent-Ready-Repository';
const api = (p) => fetch(`https://api.github.com/repos/${repo}/actions/runs/${p}`).then((r) => r.json());
for (const id of process.argv.slice(2)) {
  const run = await api(id);
  const { jobs } = await api(`${id}/jobs`);
  console.log(`\n**${run.name} #${run.run_number}** — \`${run.conclusion}\` — гілка \`${run.head_branch}\`, коміт \`${run.head_sha.slice(0, 7)}\` — ${run.html_url}\n`);
  console.log('| job | результат | час, с |');
  console.log('|---|---|---|');
  for (const j of jobs) {
    const s = j.started_at && j.completed_at ? Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000) : '—';
    console.log(`| ${j.name} | ${j.conclusion ?? j.status} | ${s} |`);
  }
}
