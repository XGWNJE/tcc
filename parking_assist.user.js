// ==UserScript==
// @name         停车场手动放行辅助用户脚本
// @namespace    https://example.com/parking-assist
// @version      1.0.2
// @description  在页面上读取车牌并根据本地任务进行提醒，含任务管理浮窗。
// @match        http://10.0.0.1:8080/webpark/*
// @match        https://10.0.0.1:8080/webpark/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'parkingAssistTasks';
  const CONFIG = { autoHideMs: 30000 }; // 提示浮窗自动隐藏时间，可调

  // 工具：读写任务
  function getTasks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) return list;
      return [];
    } catch (e) {
      return [];
    }
  }
  function saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks || []));
  }
  function normalizePlate(p) {
    // 1. 转换为大写，移除所有空白和常见分隔符
    let str = String(p || '').toUpperCase().replace(/[\s-]/g, '');
    if (!str) return '';

    // 2. 定义易混淆字符的替换规则 (字母 -> 数字)
    const replacements = {
      'I': '1', 'L': '1',
      'O': '0', 'Q': '0', 'D': '0',
      'Z': '2',
      'S': '5',
      'B': '8',
      'G': '6',
    };

    // 3. 智能替换：保留省份简称后的城市代码（字母），只替换后面的部分
    let firstPart = '';
    let rest = '';

    // 判断是否为 “中字+字母” 开头
    if (/^[\u4e00-\u9fa5][A-Z]/.test(str)) {
      firstPart = str.substring(0, 2); // 保留 “粤B”
      rest = str.substring(2);      // 对 “123I5” 进行替换
    } else {
      // 如果不是标准开头（例如用户只输入了 “B123I5”），则对整个字符串进行替换
      rest = str;
    }

    // 4. 执行替换
    for (const key in replacements) {
      rest = rest.replace(new RegExp(key, 'g'), replacements[key]);
    }

    return firstPart + rest;
  }

  // 样式注入
  function injectStyles() {
    const css = `
      .pa-reminder {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 999999;
        
        background: rgba(25, 28, 32, 0.88);
        backdrop-filter: blur(16px) saturate(180%);
        -webkit-backdrop-filter: blur(16px) saturate(180%);

        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 16px 48px rgba(0,0,0,0.35);
        border-radius: 24px;
        
        padding: 40px;
        min-width: 400px;
        max-width: 520px;
        font-family: 'Microsoft YaHei', Arial, sans-serif;
        
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 36px;
        color: #f0f0f0;
      }
      .pa-reminder-title { 
        color: #ffffff; 
        font-weight: 700;
        font-size: 26px;
        margin: 0; 
        text-align: center;
        text-shadow: 0 2px 5px rgba(0,0,0,0.5);
      }
      .pa-reminder-right-group { display: none; } /* No longer used */
      .pa-plate-chip {
        display: inline-block;
        padding: 8px 20px;
        border-radius: 10px;
        
        background: linear-gradient(135deg, #FFD700, #FFB800);
        color: #1a1a1a;
        font-weight: 700;
        font-size: 20px;
        letter-spacing: 2px;
        border: 1px solid rgba(0,0,0,0.15);
        box-shadow: 0 4px 8px rgba(0,0,0,0.25);
        white-space: nowrap;
        text-align: center;
      }
      .pa-animate { animation: pa-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
      @keyframes pa-pop {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      .pa-btn { cursor: pointer; border: none; border-radius: 4px; padding: 6px 10px; }

      .pa-panel-toggle {
        position: fixed; right: 12px; bottom: 12px; z-index: 999999;
        background: rgba(0, 123, 255, 0.8);
        backdrop-filter: blur(8px);
        color: #fff; 
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 50px; /* 圆角改为胶囊状 */
        padding: 10px 18px; 
        cursor: pointer; 
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s ease-in-out;
      }
      .pa-panel-toggle:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0,123,255,0.3);
      }
      .pa-panel {
        position: fixed; right: 12px; bottom: 52px; z-index: 999999;
        width: 360px; max-height: 60vh; overflow-y: auto;
        
        background: rgba(28, 31, 36, 0.85);
        backdrop-filter: blur(12px) saturate(150%);
        -webkit-backdrop-filter: blur(12px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 12px 32px rgba(0,0,0,0.3);
        border-radius: 16px;
        
        padding: 16px;
        color: #e0e0e0; /* 默认文字颜色改为浅色 */
        font-family: 'Microsoft YaHei', Arial, sans-serif;
      }
      .pa-panel h4 { margin: 0 0 12px; font-size: 18px; color: #ffffff; font-weight: 600; text-shadow: 0 1px 3px rgba(0,0,0,0.3); }
      .pa-field { margin-bottom: 10px; }
      .pa-field input, .pa-field textarea {
        width: 100%; box-sizing: border-box; padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px; 
        font-size: 14px;
        background: rgba(0,0,0,0.25);
        color: #f0f0f0;
        transition: all 0.2s ease;
      }
      .pa-field input::placeholder, .pa-field textarea::placeholder { color: rgba(255,255,255,0.4); }
      .pa-field input:focus, .pa-field textarea:focus {
        background: rgba(0,0,0,0.4);
        border-color: rgba(0, 123, 255, 0.7);
        outline: none;
      }
      .pa-actions { display: flex; gap: 10px; margin-top: 12px; }
      .pa-btn-primary { background: #007bff; color: #fff; flex: 1; padding: 10px; border-radius: 8px; }
      .pa-btn-secondary { background: rgba(255,255,255,0.15); color: #f0f0f0; flex: 1; padding: 10px; border-radius: 8px; }
      .pa-task { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-top: 12px; }
      .pa-task-head { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
      .pa-task-head strong { color: #ffffff; font-weight: 600; }
      .pa-task-head::after { 
        content: '▾'; 
        font-size: 16px; 
        color: #a0a0a0; 
        transition: transform 0.3s ease;
      }
      .pa-task.collapsed .pa-task-head::after { transform: rotate(-90deg); }
      .pa-task-plates { 
        color: #a0a0a0; font-size: 13px; margin-top: 8px; word-break: break-all;
        max-height: 500px; /* For transition */
        overflow: hidden;
        transition: max-height 0.4s ease, margin-top 0.4s ease, opacity 0.3s ease-in-out;
        opacity: 1;
      }
      .pa-task.collapsed .pa-task-plates {
        max-height: 0;
        margin-top: 0;
        opacity: 0;
      }
      .pa-task-btn { border: none; background: rgba(255,255,255,0.1); color: #fff; border-radius: 6px; padding: 5px 10px; cursor: pointer; margin-left: 8px; transition: background 0.2s ease; }
      .pa-task-btn:hover { background: rgba(255,255,255,0.2); }
      .pa-task-btn[data-act="del"] { background: rgba(255, 77, 79, 0.2); }
      .pa-task-btn[data-act="del"]:hover { background: rgba(255, 77, 79, 0.4); }
      .pa-toast { position: fixed; bottom: 12px; left: 12px; background: rgba(0,0,0,0.8); color: #fff; padding: 8px 12px; border-radius: 6px; z-index: 999999; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // 提示浮窗
  let reminderEl = null;
  let reminderTimer = null;
  let outsideClickListener = null;

  function ensureReminder() {
    if (reminderEl) return reminderEl;
    reminderEl = document.createElement('div');
    reminderEl.className = 'pa-reminder';
    reminderEl.style.display = 'none';
    reminderEl.innerHTML = `
      <div class="pa-reminder-title" id="paReminderTitle"></div>
      <div class="pa-plate-chip" id="paReminderPlate"></div>
    `;
    const mount = document.getElementById('userScriptUIPanel') || document.body;
    mount.appendChild(reminderEl);
    return reminderEl;
  }

  function showReminder(plate, msg) {
    ensureReminder();
    document.getElementById('paReminderTitle').textContent = msg || '';
    document.getElementById('paReminderPlate').textContent = plate || '';
    reminderEl.style.display = 'flex';

    // 重新触发动效
    reminderEl.classList.remove('pa-animate');
    void reminderEl.offsetWidth;
    reminderEl.classList.add('pa-animate');

    if (reminderTimer) clearTimeout(reminderTimer);
    reminderTimer = setTimeout(hideReminder, CONFIG.autoHideMs);

    // 添加外部点击监听
    setTimeout(() => { // 延迟以避免立即触发
      if (outsideClickListener) window.removeEventListener('click', outsideClickListener);
      outsideClickListener = (e) => {
        if (reminderEl && !reminderEl.contains(e.target)) {
          hideReminder();
        }
      };
      window.addEventListener('click', outsideClickListener);
    }, 100);
  }

  function hideReminder() {
    if (!reminderEl) return;
    reminderEl.style.display = 'none';
    if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
    // 移除外部点击监听
    if (outsideClickListener) {
      window.removeEventListener('click', outsideClickListener);
      outsideClickListener = null;
    }
  }

  // 任务管理面板
  let panelEl, toggleBtnEl;
  let editingId = null;
  function renderPanel() {
    toggleBtnEl = document.createElement('button');
    toggleBtnEl.className = 'pa-panel-toggle';
    toggleBtnEl.textContent = '任务管理';

    panelEl = document.createElement('div');
    panelEl.className = 'pa-panel';
    panelEl.style.display = 'none';
    panelEl.innerHTML = `
      <h4>临时任务管理</h4>
      <div class="pa-field">
        <textarea id="paInputPlates" rows="3" placeholder="多个车牌请用逗号或换行分隔"></textarea>
      </div>
      <div class="pa-field">
        <input type="text" id="paInputMsg" placeholder="输入提示信息 (例如：月卡用户)">
      </div>
      <div class="pa-actions">
        <button class="pa-btn pa-btn-primary" id="paBtnSave">添加/更新任务</button>
        <button class="pa-btn pa-btn-secondary" id="paBtnReset">清空编辑</button>
      </div>
      <div id="paTaskList"></div>
    `;

    const mount = document.getElementById('userScriptUIPanel') || document.body;
    mount.appendChild(toggleBtnEl);
    mount.appendChild(panelEl);

    toggleBtnEl.addEventListener('click', () => {
      panelEl.style.display = panelEl.style.display === 'none' ? 'block' : 'none';
      if (panelEl.style.display === 'block') renderTaskList();
    });
    document.getElementById('paBtnSave').addEventListener('click', handleSaveTask);
    document.getElementById('paBtnReset').addEventListener('click', () => { editingId = null; setForm('', ''); });
  }

  function setForm(platesStr, msg) {
    document.getElementById('paInputPlates').value = platesStr || '';
    document.getElementById('paInputMsg').value = msg || '';
  }

  function toast(message) {
    const t = document.createElement('div');
    t.className = 'pa-toast';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  function handleSaveTask() {
    const rawPlates = document.getElementById('paInputPlates').value || '';
    const msg = (document.getElementById('paInputMsg').value || '').trim();
    const plates = rawPlates.split(/[,\n]+/).map(normalizePlate).filter(Boolean);
    if (!msg || plates.length === 0) { toast('请填写车牌和提示信息'); return; }

    const tasks = getTasks();
    if (editingId) {
      const idx = tasks.findIndex(t => t.id === editingId);
      if (idx >= 0) {
        tasks[idx].message = msg;
        tasks[idx].licensePlates = Array.from(new Set(plates));
        saveTasks(tasks);
        toast('任务已更新');
        editingId = null;
        setForm('', '');
        renderTaskList();
        return;
      }
    }

    // 根据 PRD：同提示信息合并更新车牌列表，否则创建新任务
    const exist = tasks.find(t => (t.message || '') === msg);
    if (exist) {
      exist.licensePlates = Array.from(new Set([...(exist.licensePlates || []).map(normalizePlate), ...plates]));
      saveTasks(tasks);
      toast('已更新现有任务的车牌列表');
    } else {
      const newTask = { id: 'task_' + Date.now(), message: msg, licensePlates: Array.from(new Set(plates)) };
      tasks.push(newTask);
      saveTasks(tasks);
      toast('任务已添加');
    }
    setForm('', '');
    renderTaskList();
  }

  function renderTaskList() {
    const box = document.getElementById('paTaskList');
    const tasks = getTasks();
    box.innerHTML = '';
    if (!tasks.length) { box.innerHTML = '<div style="text-align: center; color: #888;">暂无任务</div>'; return; }

    const shouldCollapseAll = tasks.length > 3; // 智能折叠阈值

    tasks.forEach(task => {
      const el = document.createElement('div');
      el.className = 'pa-task' + (shouldCollapseAll ? ' collapsed' : '');
      el.innerHTML = `
        <div class="pa-task-head">
          <div><strong>${escapeHtml(task.message || '')}</strong></div>
          <div class="pa-task-actions">
            <button class="pa-task-btn" data-act="edit" data-id="${task.id}">编辑</button>
            <button class="pa-task-btn" data-act="del" data-id="${task.id}">删除</button>
          </div>
        </div>
        <div class="pa-task-plates">车牌：${(task.licensePlates || []).map(escapeHtml).join('，')}</div>
      `;
      box.appendChild(el);

      // 折叠/展开逻辑
      const head = el.querySelector('.pa-task-head');
      head.addEventListener('click', (e) => {
        // 避免点击按钮时触发折叠
        if (e.target.closest('.pa-task-btn')) return;
        el.classList.toggle('collapsed');
      });
    });

    // 统一处理按钮事件
    box.querySelectorAll('.pa-task-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡到 head
        const id = e.currentTarget.getAttribute('data-id');
        const act = e.currentTarget.getAttribute('data-act');
        const tasks = getTasks();
        const idx = tasks.findIndex(t => t.id === id);
        if (idx < 0) return;
        if (act === 'edit') {
          const t = tasks[idx];
          editingId = id;
          setForm((t.licensePlates || []).join(','), t.message || '');
          toast('进入编辑模式');
        } else if (act === 'del') {
          tasks.splice(idx, 1);
          saveTasks(tasks);
          toast('任务已删除');
          renderTaskList();
        }
      });
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));
  }

  // 车牌读取与匹配
  let lastPlate = '';
  function findPlateElement() {
    // 优先匹配真实页面提供的元素 id，其次匹配一组候选并按文本解析选择
    const direct = document.getElementById('outtype_25');
    if (direct) return direct;
    const candidates = Array.from(document.querySelectorAll('div[id^="outtype_"], #currentPlate, .license-plate-display'));
    for (const el of candidates) {
      const txt = el ? (el.textContent || el.innerText || '') : '';
      const plate = extractPlateFromText(txt);
      if (plate) return el;
    }
    return document.querySelector('.license-plate-display') || document.getElementById('currentPlate') || null;
  }

  function extractPlateFromText(raw) {
    const str = String(raw || '').replace(/\u00A0|&nbsp;/g, ' ').trim();
    if (str === '无牌车') {
        return '无牌车';
    }
    // 移除所有空白和分隔符后再匹配，以支持 `粤 B 12345` 这样的格式
    const cleanStr = str.toUpperCase().replace(/[\s-]/g, '');
    const PLATE_RE = /[一-龥][A-Z][A-Z0-9]{5,6}/;
    const m = cleanStr.match(PLATE_RE);
    if (m) return m[0]; // 直接返回匹配结果，因为它已经是标准化的
    return '';
  }

  function getCurrentPlate() {
    const el = findPlateElement();
    const txt = el ? (el.textContent || el.innerText || '') : '';
    const plate = extractPlateFromText(txt);
    return plate;
  }
  function checkTasksAndNotify(plate) {
    if (!plate) return hideReminder();
    const tasks = getTasks();
    for (const t of tasks) {
      const list = (t.licensePlates || []).map(normalizePlate);
      if (list.includes(plate)) {
        showReminder(plate, t.message || '');
        return; // 命中一个任务即提示
      }
    }
    hideReminder();
  }

  function startObservers() {
    const target = findPlateElement();
    if (target) {
      const mo = new MutationObserver(() => {
        const p = getCurrentPlate();
        if (p !== lastPlate) { lastPlate = p; checkTasksAndNotify(p); }
      });
      mo.observe(target, { characterData: true, childList: true, subtree: true });
    }
    // 兜底轮询，避免不同页面结构漏变更或目标元素临时不存在
    setInterval(() => {
      const p = getCurrentPlate();
      if (p !== lastPlate) { lastPlate = p; checkTasksAndNotify(p); }
    }, 700);
  }

  // 初始化
  function init() {
    injectStyles();
    ensureReminder();
    renderPanel();
    lastPlate = getCurrentPlate();
    checkTasksAndNotify(lastPlate);
    startObservers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
