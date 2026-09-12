// Draft values are plain text, never executable HTML or trusted wiki markup.
export function wikiText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/[<>\[\]{}|]/g, c => `&#${c.charCodeAt(0)};`).replace(/^([=*#;:])/gm, c => `&#${c.charCodeAt(0)};`);
}
export function safeURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function makeDrafts(data) {
  if (!/^[a-z][a-z0-9_]*$/.test(data.id)) throw new Error('Use a snake_case entry ID beginning with a letter.');
  if (!safeURL(data.wiki) || !safeURL(data.cad)) throw new Error('Use public http(s) source URLs without embedded credentials.');
  const fields = [['Author / attribution', 'author'], ['Purpose and changes', 'description'], ['Source wiki URL', 'wiki'], ['Editable CAD / source URL', 'cad'], ['License and permission evidence', 'license'], ['Dimensions, units and interfaces', 'dimensions'], ['Validation evidence', 'validation'], ['Known limitations / review needed', 'limitations']];
  for (const key of ['name', ...fields.map(x => x[1])]) if (!String(data[key] ?? '').trim()) throw new Error('Complete all fields; state unknown or not tested where appropriate.');
  const wiki = `== ${wikiText(data.name)} ==\nDesign documentation draft — not an accepted library entry or construction approval.\n\n${fields.map(([label, key]) => `=== ${label} ===\n${wikiText(data[key])}`).join('\n\n')}\n\n=== Proposed library entry ===\nID: ${wikiText(data.id)}\nLayer: ${wikiText(data.layer)}\nStatus: requested for review; not yet accepted.\n`;
  const plain = value => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const review = `# Request design review: ${plain(data.name)}\n\nThis is a request for discussion/inclusion review, not a claim of acceptance or fabrication readiness.\n\nProposed ID: ${data.id}\nLayer: ${plain(data.layer)}\n\n${fields.map(([label, key]) => `## ${label}\n${plain(data[key])}`).join('\n\n')}\n\n## Requested next step\nPlease advise on the appropriate entry/layer, ownership, missing evidence and validation needed before an implementation PR.\n\n- [ ] Confirm provenance and redistribution rights\n- [ ] Review schema.py, compiler.py, meta.yaml and expect.yaml\n- [ ] Inspect code/output validation reports and limitations\n- [ ] Maintainer review (inclusion is not automatic)\n`;
  return { wiki, review, wikiURL: `https://wiki.opensourceecology.org/wiki/${encodeURIComponent(data.name.trim().replace(/ /g, '_'))}`, issueURL: `https://github.com/OpenSourceEcology/vcs-library/issues/new?${new URLSearchParams({ title: `Design review request: ${data.name}`, body: review.length < 5500 ? review : 'Please paste the full review request downloaded from Iconic Tutor here before submitting.' })}` };
}
