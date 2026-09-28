// Moderation page. The admin signs in with Supabase Auth; row-level security lets only the
// admin email (set in the migration) read, approve or delete claims. Deleting a claim
// frees the plot. Uploaded logos wait here until approved; link logos are live at once.

import { createClient } from '@supabase/supabase-js';

const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const $ = (id) => document.getElementById(id);
let tab = 'pending';

function row(claim) {
  const el = document.createElement('div');
  el.className = 'row';
  const img = document.createElement('img');
  img.src = claim.logo_url;
  img.alt = '';
  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = claim.title;
  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = claim.description;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${claim.cell} · ${new Date(claim.created_at).toLocaleString()} · logo: ${claim.logo_type}`;
  info.append(title, desc);
  if (claim.url) {
    const a = document.createElement('a');
    a.href = claim.url;
    a.textContent = claim.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
    info.append(a);
  }
  info.append(meta);

  const actions = document.createElement('div');
  actions.className = 'actions';
  if (claim.status === 'pending') {
    const ok = document.createElement('button');
    ok.className = 'btn';
    ok.textContent = 'Approve';
    ok.onclick = () => act(el, () => sb.from('claims').update({ status: 'approved' }).eq('cell', claim.cell));
    actions.append(ok);
  }
  const remove = document.createElement('button');
  remove.className = 'btn bad';
  remove.textContent = 'Remove';
  remove.onclick = () => {
    if (confirm(`Remove "${claim.title}"? The plot becomes free again.`)) act(el, () => sb.from('claims').delete().eq('cell', claim.cell));
  };
  actions.append(remove);
  el.append(img, info, actions);
  return el;
}

async function act(el, fn) {
  el.style.opacity = 0.5;
  const { error } = await fn();
  if (error) {
    el.style.opacity = 1;
    $('status').textContent = `Failed: ${error.message}`;
  } else {
    el.remove();
  }
}

async function load() {
  $('status').textContent = 'Loading…';
  $('list').replaceChildren();
  const { data, error } = await sb
    .from('claims')
    .select('cell,title,description,url,domain,logo_type,logo_url,status,created_at')
    .eq('status', tab)
    .order('created_at', { ascending: tab === 'pending' })
    .limit(200);
  if (error) {
    $('status').textContent = `Could not load claims: ${error.message}`;
    return;
  }
  $('status').textContent = data.length
    ? `${data.length} ${tab === 'pending' ? 'waiting for review' : 'live plots (newest first)'}`
    : tab === 'pending'
      ? 'Nothing to review. 🎉'
      : 'No live plots yet.';
  $('list').replaceChildren(...data.map(row));
}

function showApp(signedIn) {
  $('login').classList.toggle('hidden', signedIn);
  $('app').classList.toggle('hidden', !signedIn);
  if (signedIn) load();
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value, password: $('password').value });
  if (error) $('login-error').textContent = error.message;
  else showApp(true);
});

document.querySelectorAll('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  })
);
$('refresh').addEventListener('click', load);
$('signout').addEventListener('click', async () => {
  await sb.auth.signOut();
  showApp(false);
});

sb.auth.getSession().then(({ data }) => showApp(!!data.session));
