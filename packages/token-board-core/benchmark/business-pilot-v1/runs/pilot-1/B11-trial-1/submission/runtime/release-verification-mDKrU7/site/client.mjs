document.querySelector('#load').addEventListener('click', async () => {
  const user = document.querySelector('#identity').value;
  const status = document.querySelector('#status');
  const content = document.querySelector('#content');
  content.textContent = '';
  status.textContent = '读取中…';
  try {
    const response = await fetch(`${window.CONTENT_API}/api/private-posts/release-notes`, {
      headers: user ? { 'x-local-user': user } : {}, cache: 'no-store',
    });
    if (!response.ok) throw new Error(`正文接口返回 ${response.status}`);
    const post = await response.json();
    content.innerHTML = post.contentHtml;
    status.textContent = post.title;
  } catch (error) { status.textContent = error.message; }
});
