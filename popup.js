document.addEventListener('DOMContentLoaded', () => {
  const messageArea = document.getElementById('message-area');

  // タブ切り替え
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-button, .tab-content').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // 設定ページ生成
  const userSettingsDiv = document.getElementById('user-settings');
  for (let i = 0; i < 10; i++) {
    userSettingsDiv.innerHTML += `
      <div class="user-setting-row">
        <input type="text" class="user-name-setting" placeholder="ユーザー名">
        <input type="number" class="user-id-setting" placeholder="DiscordユーザーID">
      </div>`;
  }

  // メインページ生成
  const playerInputsDiv = document.getElementById('player-inputs');
  for (let i = 0; i < 4; i++) {
    playerInputsDiv.innerHTML += `
      <div class="player-row">
        <input type="text" class="player-name" list="user-list" placeholder="プレイヤー${i+1}">
        <input type="number" class="player-score" placeholder="点数" step="1000">
      </div>`;
  }

  // メイン入力の自動保存・読み込み
  function saveMainInputs() {
    const arr = [];
    document.querySelectorAll('.player-row').forEach(row => {
      arr.push({
        name: row.querySelector('.player-name').value,
        score: row.querySelector('.player-score').value
      });
    });
    chrome.storage.local.set({ mainInputs: arr });
  }
  function loadMainInputs() {
    chrome.storage.local.get(['mainInputs'], res => {
      if (res.mainInputs) {
        document.querySelectorAll('.player-row').forEach((row, i) => {
          const p = res.mainInputs[i] || {};
          row.querySelector('.player-name').value = p.name || '';
          row.querySelector('.player-score').value = p.score || '';
        });
      }
    });
  }
  document.querySelectorAll('.player-name, .player-score').forEach(input => {
    input.addEventListener('input', saveMainInputs);
  });

  // 設定読み込み
  function loadSettings() {
    chrome.storage.local.get(['gasApiUrl','webhookUrl','users','rate'], res => {
      if (res.gasApiUrl) document.getElementById('gas-api-url').value = res.gasApiUrl;
      if (res.webhookUrl) document.getElementById('webhook-url').value = res.webhookUrl;
      if (res.users) res.users.forEach((u,i) => {
        const names = document.querySelectorAll('.user-name-setting');
        const ids   = document.querySelectorAll('.user-id-setting');
        if (names[i]) names[i].value = u.name;
        if (ids[i])   ids[i].value   = u.id;
      });
      if (res.rate) {
        document.getElementById('rate-point').value = res.rate.point;
        document.getElementById('rate-yen').value   = res.rate.yen;
      }
      updateDatalist(res.users || []);
    });
  }
  function updateDatalist(users) {
    const dl = document.getElementById('user-list'); dl.innerHTML = '';
    users.forEach(u => { if(u.name){ const o = document.createElement('option'); o.value = u.name; dl.appendChild(o); }});
  }

  // メッセージ表示
  function showMessage(txt, type) {
    messageArea.textContent = txt;
    messageArea.className = type;
    setTimeout(() => messageArea.className = '', 5000);
  }

  // 設定保存
  document.getElementById('save-settings-button').addEventListener('click', () => {
    const gasApiUrl  = document.getElementById('gas-api-url').value;
    const webhookUrl = document.getElementById('webhook-url').value;
    const users = [];
    document.querySelectorAll('.user-name-setting').forEach((el,i) => {
      const name = el.value.trim();
      const id   = document.querySelectorAll('.user-id-setting')[i].value.trim();
      if(name&&id) users.push({name,id});
    });
    chrome.storage.local.set({gasApiUrl,webhookUrl,users}, () => {
      showMessage('設定を保存しました。','success'); updateDatalist(users);
    });
  });

  // 送信ボタンロジック
  document.getElementById('send-button').addEventListener('click', () => {
    const btn = document.getElementById('send-button');
    btn.disabled = true; btn.textContent = '送信中...';

    runSettlement();
  });

  // 点数精算処理
  function runSettlement() {
    chrome.storage.local.get(['gasApiUrl','webhookUrl','users','rate'], async settings => {
      try {
        if(!settings.gasApiUrl) throw new Error('GAS URL未設定');
        if(!settings.users||settings.users.length<1) throw new Error('ユーザー未設定');

        const inputs = [];
        document.querySelectorAll('.player-row').forEach(row => {
          const name = row.querySelector('.player-name').value.trim();
          const score = row.querySelector('.player-score').value;
          if(name && score) inputs.push({ name, score: parseInt(score,10) });
        });
        if(inputs.length<3) throw new Error('プレイヤー3名以上必要');

        const rateP = parseInt(document.getElementById('rate-point').value,10);
        const rateY = parseInt(document.getElementById('rate-yen').value,10);
        if(!rateP||!rateY) throw new Error('レート未設定');
        chrome.storage.local.set({ rate:{point:rateP,yen:rateY} });

        const payload = {
          players: inputs.map(p => ({...p, id: settings.users.find(u=>u.name===p.name).id})),
          ratePoint: rateP,
          rateYen: rateY,
          sanma: document.getElementById('sanma-checkbox').checked,
          webhookUrl: settings.webhookUrl
        };
        const res = await fetch(settings.gasApiUrl, { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
        if(!res.ok) throw new Error(`通信失敗: ${res.status}`);
        const result = await res.json();
        if(result.status==='success') {
          showMessage(result.message,'success');
          document.querySelectorAll('.player-score').forEach(i=>i.value=''); saveMainInputs();
        } else throw new Error(result.message);
      } catch(e) {
        showMessage(e.message,'error');
      } finally { resetBtn(); }
    });
  }

  // ボタンリセット
  function resetBtn() {
    const btn = document.getElementById('send-button');
    btn.disabled = false; btn.textContent = '送信';
  }

  // 初期化
  loadSettings();
  loadMainInputs();
});