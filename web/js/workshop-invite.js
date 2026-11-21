// The link carries a private code in its fragment. Remove it before loading the
// workshop and leave sign-in to an explicit button in the current browser.
export function consumeInvitation() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('invite')) return null;
  const code = fragment.get('invite');
  fragment.delete('invite');
  history.replaceState(null, '', location.pathname + location.search + (fragment.size ? '#' + fragment : ''));
  return code || null;
}
