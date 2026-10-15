import { Codex } from '@openai/codex-sdk';
import { SearchEvidenceCollector, SearchEvidenceError, SEARCH_SCHEMA } from './search-evidence.mjs';

process.on('message', async job => {
  try {
    const codex = new Codex({
      codexPathOverride: job.binary,
      env: job.env,
      configOverrides: job.configOverrides,
    });
    const discovery = job.kind === 'discoverYoutube';
    const thread = codex.startThread({ workingDirectory: job.scratch, skipGitRepoCheck: true, approvalPolicy: 'never', sandboxMode: 'danger-full-access', webSearchMode: discovery ? 'live' : 'disabled' });
    if (discovery) {
      const collector = new SearchEvidenceCollector(job.runtimeVersion);
      const controller = new AbortController();
      const streamed = await thread.runStreamed(job.prompt, { outputSchema: job.schema, signal: controller.signal });
      let finalResponse = null;
      let completed = false;
      let usage = null;
      try {
        for await (const event of streamed.events) {
          collector.add(event);
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalResponse = event.item.text;
          if (event.type === 'turn.completed') { completed = true; usage = event.usage; }
          if (event.type === 'turn.failed' || event.type === 'error') throw new SearchEvidenceError('provider_unavailable');
        }
      } catch (error) { controller.abort(); throw error; }
      if (!completed || typeof finalResponse !== 'string') throw new SearchEvidenceError('provider_unavailable');
      let parsed;
      try { parsed = JSON.parse(finalResponse); } catch { throw new SearchEvidenceError('invalid_agent_output'); }
      const candidates = collector.candidates(parsed);
      const message = { ok:true, finalResponse:JSON.stringify({candidates}), usage, schemaVersion:SEARCH_SCHEMA, searchEvidence:candidates, searchEventCount:collector.completed };
      if (Buffer.byteLength(JSON.stringify(message)) > 1024 * 1024) throw new SearchEvidenceError('search_provenance_unavailable');
      process.send?.(message);
    } else {
      const result = await thread.run(job.prompt, { outputSchema: job.schema });
      process.send?.({ ok: true, finalResponse: result.finalResponse, usage: result.usage });
    }
  } catch (error) {
    const detail = String(error);
    const code = error instanceof SearchEvidenceError ? error.code : /401|auth|login/i.test(detail) ? 'provider_auth_failed' : /quota|usage limit|rate limit|429/i.test(detail) ? 'provider_quota_exceeded' : 'provider_unavailable';
    process.send?.({ ok: false, code });
  }
});
