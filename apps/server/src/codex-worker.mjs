import { Codex } from '@openai/codex-sdk';

process.on('message', async job => {
  try {
    const configOverrides = [
      'default_permissions="music_agent"',
      `permissions.music_agent.filesystem={":root"="deny",":minimal"="read",${JSON.stringify(job.scratch)}="read",${JSON.stringify(job.runtime)}="read"}`,
      'permissions.music_agent.network={"*"="deny"}',
    ];
    const codex = new Codex({
      codexPathOverride: job.binary,
      env: { PATH: job.path, HOME: job.home, CODEX_HOME: job.codexHome },
      configOverrides,
    });
    const thread = codex.startThread({ workingDirectory: job.scratch, skipGitRepoCheck: true, approvalPolicy: 'never', webSearchMode: 'disabled' });
    const result = await thread.run(job.prompt, { outputSchema: job.schema });
    process.send?.({ ok: true, finalResponse: result.finalResponse, usage: result.usage });
  } catch (error) {
    const detail = String(error);
    const code = /401|auth|login/i.test(detail) ? 'provider_auth_failed' : /quota|usage limit|rate limit|429/i.test(detail) ? 'provider_quota_exceeded' : 'provider_unavailable';
    process.send?.({ ok: false, code });
  }
});
