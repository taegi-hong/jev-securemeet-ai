async function loadItems() {
  try {
    const res = await fetch('/api/items');
    const data = await res.json();
    const list = document.getElementById('itemList');
    list.innerHTML = '';
    data.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${item.title}</span><span style="font-size:0.75rem; color:#64748b;">${item.created_at}</span>`;
      list.appendChild(li);
    });
  } catch (e) {
    document.getElementById('itemList').innerHTML = '<li>로컬 백엔드 서버(port 9050) 실행 중...</li>';
  }
}

document.getElementById('btnAdd').addEventListener('click', async () => {
  const input = document.getElementById('itemInput');
  const val = input.value.trim();
  if (!val) return;
  try {
    await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: val })
    });
    input.value = '';
    loadItems();
  } catch (e) {
    alert('저장 실패: ' + e);
  }
});

loadItems();
