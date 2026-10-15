import { Codex } from '@openai/codex-sdk';

process.on('message', async job => {
  try {
    const codex = new Codex({
      codexPathOverride: job.binary,
      env: job.env,
      configOverrides: job.configOverrides,
    });
    const thread = codex.startThread({ workingDirectory: job.scratch, skipGitRepoCheck: true, approvalPolicy: 'never', sandboxMode: 'danger-full-access', webSearchMode: 'disabled' });
    const result = await thread.run(job.prompt, { outputSchema: job.schema });
    process.send?.({ ok: true, finalResponse: result.finalResponse, usage: result.usage });
  } catch (error) {
    const detail = String(error);
    const code = /401|auth|login/i.test(detail) ? 'provider_auth_failed' : /quota|usage limit|rate limit|429/i.test(detail) ? 'provider_quota_exceeded' : 'provider_unavailable';
    process.send?.({ ok: false, code });
  }
});
