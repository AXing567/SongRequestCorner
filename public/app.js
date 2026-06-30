const stateLabel = document.querySelector("#playerState");
const currentTitle = document.querySelector("#currentTitle");
const currentMeta = document.querySelector("#currentMeta");
const queueCount = document.querySelector("#queueCount");
const queueList = document.querySelector("#queueList");
const historyCount = document.querySelector("#historyCount");
const historyList = document.querySelector("#historyList");
const historyDay = document.querySelector("#historyDay");
const historyPrev = document.querySelector("#historyPrev");
const historyNext = document.querySelector("#historyNext");
const historyPageText = document.querySelector("#historyPageText");
const refreshBtn = document.querySelector("#refreshBtn");

const stateText = {
  idle: "空闲",
  playing: "播放中",
  paused: "已暂停",
  offline: "离线"
};

let busyCount = 0;
let latestRevision;
let historyPage = 1;
const historyPageSize = 20;

async function loadStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) {
    throw new Error("状态加载失败");
  }

  const data = await response.json();
  render(data);
}

async function loadHistory() {
  const params = new URLSearchParams({
    page: String(historyPage),
    pageSize: String(historyPageSize)
  });
  if (historyDay.value) {
    params.set("day", historyDay.value);
  }

  const response = await fetch(`/api/history?${params.toString()}`);
  if (!response.ok) {
    throw new Error("历史记录加载失败");
  }

  renderHistory(await response.json());
}

function render(data) {
  const current = data.player.current;
  latestRevision = data.player.revision;
  const isBusy = busyCount > 0 || data.player.busy || data.player.switching;
  stateLabel.textContent = data.player.switching
    ? "切换中"
    : isBusy
      ? "处理中"
      : (stateText[data.player.state] ?? data.player.state);
  stateLabel.classList.toggle("busy", isBusy);
  currentTitle.textContent = current ? `${current.track.artist} - ${current.track.title}` : "暂无播放";
  currentMeta.textContent = current
    ? `由 ${current.requester.name ?? current.requester.id} 点播`
    : "等待下一首点歌";

  queueCount.textContent = String(data.pending.length);
  queueList.innerHTML = "";

  if (data.pending.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "队列为空";
    queueList.append(empty);
    return;
  }

  data.pending.forEach((item, index) => {
    queueList.append(renderQueueItem(item, index));
  });
}

function renderQueueItem(item, index) {
  const row = document.createElement("article");
  row.className = "queue-item";
  row.innerHTML = `
    <div class="queue-index">${index + 1}</div>
    <div>
      <p class="queue-title">${escapeHtml(item.track.artist)} - ${escapeHtml(item.track.title)}</p>
      <p class="queue-meta">${escapeHtml(item.requester.name ?? item.requester.id)} · ${formatTime(
        item.requestedAt
      )}</p>
    </div>
    <div class="item-actions">
      <button title="上移" data-move="up" data-id="${item.id}">↑</button>
      <button title="下移" data-move="down" data-id="${item.id}">↓</button>
      <button class="danger" title="移除" data-remove="${item.id}">移除</button>
    </div>
  `;
  return row;
}

function renderHistory(historyPageData) {
  const history = historyPageData.items ?? [];
  historyCount.textContent = String(historyPageData.total ?? history.length);
  historyList.innerHTML = "";
  renderHistoryDays(historyPageData.days ?? []);
  const totalPages = Math.max(1, Math.ceil((historyPageData.total ?? 0) / historyPageSize));
  historyPage = Math.min(historyPage, totalPages);
  historyPageText.textContent = `第 ${historyPage} / ${totalPages} 页`;
  historyPrev.disabled = historyPage <= 1;
  historyNext.disabled = historyPage >= totalPages;

  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无播放历史";
    historyList.append(empty);
    return;
  }

  history.forEach((item) => {
    historyList.append(renderHistoryItem(item));
  });
}

function renderHistoryDays(days) {
  const selected = historyDay.value;
  historyDay.innerHTML = `<option value="">全部日期</option>`;
  days.forEach((day) => {
    const option = document.createElement("option");
    option.value = day;
    option.textContent = day;
    option.selected = day === selected;
    historyDay.append(option);
  });
}

function renderHistoryItem(item) {
  const row = document.createElement("article");
  row.className = "queue-item history-item";
  row.innerHTML = `
    <div class="queue-index">♪</div>
    <div>
      <p class="queue-title">${escapeHtml(item.track.artist)} - ${escapeHtml(item.track.title)}</p>
      <p class="queue-meta">${formatDateTime(item.playedAt)} · ${escapeHtml(
        item.requester.name ?? item.requester.id
      )}</p>
    </div>
    <div class="item-actions">
      <button title="重新加入队列" data-replay="${item.id}">加入队列</button>
    </div>
  `;
  return row;
}

async function post(path, body, button) {
  beginBusy(button);
  try {
    window.setTimeout(() => {
      if (busyCount > 0) {
        void loadStatus().catch(() => undefined);
      }
    }, 250);

    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    const result = await response.json();
    await loadStatus();
    return result;
  } finally {
    endBusy(button);
  }
}

document.body.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const action = target.dataset.action;
  const removeId = target.dataset.remove;
  const replayId = target.dataset.replay;
  const move = target.dataset.move;
  const moveId = target.dataset.id;

  if (action) {
    const path =
      action === "skip"
          ? "/api/playback/skip"
          : `/api/playback/${action}`;
    void post(path, { expectedRevision: latestRevision }, target).catch(alertError);
  }

  if (removeId) {
    void post(`/api/queue/${encodeURIComponent(removeId)}/remove`, undefined, target).catch(alertError);
  }

  if (replayId) {
    void post(`/api/history/${encodeURIComponent(replayId)}/replay`, undefined, target)
      .then(() => loadHistory())
      .catch(alertError);
  }

  if (move && moveId) {
    void post(`/api/queue/${encodeURIComponent(moveId)}/move`, { direction: move }, target).catch(alertError);
  }
});

refreshBtn.addEventListener("click", () => {
  void withBusy(refreshBtn, loadStatus).catch(alertError);
});

historyDay.addEventListener("change", () => {
  historyPage = 1;
  void loadHistory().catch(alertError);
});

historyPrev.addEventListener("click", () => {
  historyPage = Math.max(1, historyPage - 1);
  void loadHistory().catch(alertError);
});

historyNext.addEventListener("click", () => {
  historyPage += 1;
  void loadHistory().catch(alertError);
});

async function withBusy(button, action) {
  beginBusy(button);
  try {
    await action();
  } finally {
    endBusy(button);
  }
}

function beginBusy(button) {
  busyCount += 1;
  stateLabel.textContent = "处理中";
  stateLabel.classList.add("busy");
  if (button) {
    button.dataset.originalText = button.textContent ?? "";
    button.textContent = "处理中";
    button.disabled = true;
  }
}

function endBusy(button) {
  busyCount = Math.max(0, busyCount - 1);
  if (button) {
    button.textContent = button.dataset.originalText ?? button.textContent;
    button.disabled = false;
  }
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function alertError(error) {
  alert(error instanceof Error ? error.message : String(error));
}

void loadStatus().catch(alertError);
void loadHistory().catch(alertError);
setInterval(() => {
  if (busyCount === 0) {
    void loadStatus().catch(() => undefined);
  }
}, 3000);
