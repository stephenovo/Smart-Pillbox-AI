(() => {
 const key = 'pillbox-r1-beginner-progress-v1';
 const boxes = [...document.querySelectorAll('[data-step]')];
 let saved = [];
 try { const value = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(value)) saved = value; } catch {}
 boxes.forEach(box => { box.checked = saved.includes(box.dataset.step); });
 function render() {
  const count = boxes.filter(box => box.checked).length;
  document.querySelector('progress').value = count;
  document.getElementById('progress-text').textContent = `已完成 ${count} / ${boxes.length} 步`;
  boxes.forEach(box => box.closest('article').classList.toggle('done', box.checked));
 }
 function persist() {
  try { localStorage.setItem(key, JSON.stringify(boxes.filter(box => box.checked).map(box => box.dataset.step))); }
  catch { document.getElementById('storage-note').textContent = '浏览器无法保存进度，本次勾选仅在当前页面有效。'; }
  render();
 }
 boxes.forEach(box => box.addEventListener('change', persist));
 document.getElementById('reset').addEventListener('click', () => {
  if (confirm('清除这8步的完成勾选？制作资料不会删除。')) { boxes.forEach(box => { box.checked = false; }); persist(); }
 });
 render();
})();