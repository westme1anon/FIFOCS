// ==UserScript==
// @name         讯飞智课自动刷课脚本 · 调度优化版
// @namespace    https://xunketang.local/autoplay-scheduler
// @version      4.0.1
// @description  讯飞智课视频/PPT/PDF/练习助手，统一调度、可取消任务、独立资源状态与学习面板
// @author       kumiko
// @match        *://*.fifedu.com/*
// @match        *://*.xunketang.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ========== 配置项 ==========
    const CONFIG = {
        // 播放速率（1为正常速度，2为2倍速，建议不超过4）
        playbackRate: 1,
        // 自动静音
        autoMute: true,
        // 检测间隔（毫秒）
        checkInterval: 2000,
        // PPT 轮询节拍（毫秒）
        pptTickInterval: 700,
        // 同一页上接动画的点击间隔（毫秒）：一次点击可能只是多显示一段文字
        slideIntervalAnim: 2000,
        // 真正翻到新一页后，等画面渲染的间隔（毫秒）
        slideIntervalPage: 3500,
        // 单个PPT最多点击多少次（防止异常情况下无限连点把浏览器拖死）
        maxSlideClicks: 300,
        // 检测到 PPT 播放器崩溃（"很抱歉,遇到问题"）时，跳过该资源而不是重试
        skipResourceOnPptCrash: true,
        // PPT多久没有任何变化算卡住（毫秒）
        slideStuckTimeout: 30000,
        // 卡住后每隔多久重试一次（毫秒）
        slideRetryInterval: 20000,
        // 内容切换等待时间（毫秒）
        switchWait: 3000,
        // 资源完成所需的进度百分比（站点保存进度要求，常见为 90）
        progressRequired: 90,
        // 自适应练习：点击"交卷"后，等待站点更新进度的时间（毫秒）
        practiceSubmitWait: 60000,
        // 练习已交卷但站点迟迟不更新进度时，是否跳过该资源
        skipPracticeIfNotMarked: true,
        // PDF：每次向下滚动的间隔（毫秒）
        pdfScrollInterval: 2500,
        // PDF：每次滚动的比例（相对阅读区高度）
        pdfScrollStep: 0.9,
        // PDF：进度多久没变化就认为卡住（毫秒）
        pdfStuckTimeout: 30000,
        // 本节一个资源都没有时，等多久确认后进入下一节（毫秒）
        emptySectionWait: 8000,
        // 两次"尝试进入下一节"之间的最小间隔（毫秒）
        emptySectionCooldown: 20000,
        // 播放器结束后，最多等待站点确认完成多久
        progressConfirmWait: 60000,
        // 切换后等待新播放器出现的最长时间
        switchTimeout: 20000,
        // 无法识别内容时最多等待多久
        resourceLoadTimeout: 30000,
        // 视频播放重试间隔；单次播放请求的等待上限
        videoRetryInterval: 15000,
        mediaPlayTimeout: 5000,
        // PPT 卡住后最多尝试几次方向键
        pptRetryLimit: 3,
        // 日志输出到控制台
        debug: true,
    };

    // ========== 悬浮窗控制状态 ==========
    let isRunning = false;
    let controlPanel = null;
    let statusText = null;
    let progressBar = null;
    let progressText = null;
    let startBtn = null;
    let stopBtn = null;
    let logContainer = null;
    let resourceText = null;
    let completedText = null;
    let totalText = null;
    let skippedText = null;
    let kindText = null;
    let statusIndicator = null;

    // ========== 悬浮窗UI ==========
    function createControlPanel() {
        // 只在整个页面里注入一份面板
        if (window.top !== window.self) return;
        if (document.getElementById('xunketang-autoplay-scheduler-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'xunketang-autoplay-scheduler-panel';
        panel.setAttribute('role', 'complementary');
        panel.setAttribute('aria-label', '讯飞智课学习助手');
        panel.innerHTML = `
            <style>
                #xunketang-autoplay-scheduler-panel {
                    --ink: #18342f; --muted: #76847e; --green: #16836a; --line: #e6ece8;
                    position: fixed; top: 24px; right: 24px; width: 344px;
                    max-width: calc(100vw - 24px); max-height: calc(100vh - 48px);
                    overflow: auto; scrollbar-width: thin; z-index: 999999;
                    color: var(--ink); background: #f8faf8; border: 1px solid rgba(255,255,255,.8);
                    border-radius: 22px; box-shadow: 0 20px 65px #183b3026, 0 3px 12px #183b3010;
                    font: 13px/1.5 'Segoe UI', 'Microsoft YaHei', sans-serif; text-align: left;
                    isolation: isolate; color-scheme: light;
                }
                #xunketang-autoplay-scheduler-panel * { box-sizing: border-box; }
                #xunketang-autoplay-scheduler-panel button { font: inherit; cursor: pointer; margin: 0; }
                #xunketang-autoplay-scheduler-panel button:focus-visible,
                #xunketang-autoplay-scheduler-panel summary:focus-visible { outline: 3px solid #6cd5b2; outline-offset: 3px; }
                #xunketang-autoplay-scheduler-panel svg { display: block; flex-shrink: 0; }
                #xunketang-autoplay-scheduler-panel .panel-header {
                    display: flex; align-items: center; gap: 11px; padding: 22px 18px;
                    color: #f7fffb; background: radial-gradient(ellipse at 90% 0%, #347c66 0%, transparent 70%), #193f35;
                    cursor: grab; touch-action: none; user-select: none;
                }
                #xunketang-autoplay-scheduler-panel .brand-mark {
                    display: grid; place-items: center; width: 38px; height: 38px;
                    background: #ffffff12; border: 1px solid #ffffff24; border-radius: 12px;
                }
                #xunketang-autoplay-scheduler-panel .brand-copy { flex: 1; min-width: 0; }
                #xunketang-autoplay-scheduler-panel .panel-title { font-size: 16px; font-weight: 650; letter-spacing: .5px; }
                #xunketang-autoplay-scheduler-panel .panel-subtitle { margin-top: 3px; color: #b4cfc2; font-size: 10px; letter-spacing: .8px; }
                #xunketang-autoplay-scheduler-panel .panel-controls { display: flex; gap: 5px; align-self: flex-start; }
                #xunketang-autoplay-scheduler-panel .panel-btn {
                    display: grid; place-items: center; width: 25px; height: 25px; border: 0;
                    background: transparent; color: #d1e5d9; border-radius: 7px; font-size: 18px; line-height: 1;
                }
                #xunketang-autoplay-scheduler-panel .panel-btn:hover { background: #ffffff1c; color: #fff; }
                #xunketang-autoplay-scheduler-panel .panel-body { padding: 18px; }
                #xunketang-autoplay-scheduler-panel .status-section { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }
                #xunketang-autoplay-scheduler-panel .status-dot { width: 7px; height: 7px; flex-shrink: 0; margin-top: 6px; border-radius: 50%; background: #8b9c92; box-shadow: 0 0 0 4px #8b9c9212; }
                #xunketang-autoplay-scheduler-panel .status-value { color: #537063; font-size: 11px; overflow-wrap: anywhere; }
                #xunketang-autoplay-scheduler-panel .resource-card { padding: 16px; background: #fff; border: 1px solid var(--line); border-radius: 14px; }
                #xunketang-autoplay-scheduler-panel .card-eyebrow { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 10px; letter-spacing: .7px; }
                #xunketang-autoplay-scheduler-panel .type-tag { color: #44836c; background: #edf6ef; border-radius: 5px; padding: 2px 7px; font-size: 10px; letter-spacing: 0; }
                #xunketang-autoplay-scheduler-panel .resource-title { margin: 10px 0 16px; font-size: 15px; font-weight: 600; line-height: 1.65; overflow-wrap: anywhere; }
                #xunketang-autoplay-scheduler-panel .progress-heading { display: flex; align-items: baseline; justify-content: space-between; color: var(--muted); font-size: 10px; }
                #xunketang-autoplay-scheduler-panel .progress-percent { color: var(--green); font-size: 23px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
                #xunketang-autoplay-scheduler-panel .progress-bar-container { margin-top: 7px; height: 6px; background: #edf2ed; border-radius: 8px; overflow: hidden; }
                #xunketang-autoplay-scheduler-panel .progress-bar-fill { width: 0%; height: 100%; background: linear-gradient(90deg,#16836a,#6abe8e); border-radius: inherit; transition: width .3s ease; }
                #xunketang-autoplay-scheduler-panel .progress-info { margin-top: 9px; color: var(--muted); font-size: 10px; line-height: 1.6; }
                #xunketang-autoplay-scheduler-panel .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin: 12px 0 18px; }
                #xunketang-autoplay-scheduler-panel .stat { background: #eef3ee; border: 1px solid #e7eee6; border-radius: 11px; padding: 10px 11px; }
                #xunketang-autoplay-scheduler-panel .stat-number { display: block; font-size: 21px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; }
                #xunketang-autoplay-scheduler-panel .stat-label { display: block; color: var(--muted); font-size: 10px; margin-top: 5px; }
                #xunketang-autoplay-scheduler-panel .stat-complete .stat-number { color: #16836a; }
                #xunketang-autoplay-scheduler-panel .stat-skip .stat-number { color: #a17d43; }
                #xunketang-autoplay-scheduler-panel .button-section { display: flex; gap: 9px; }
                #xunketang-autoplay-scheduler-panel .action-btn { display: flex; align-items: center; justify-content: center; gap: 7px; border-radius: 10px; height: 43px; border: 1px solid transparent; font-size: 12px; font-weight: 600; transition: background .15s, transform .15s; }
                #xunketang-autoplay-scheduler-panel .action-btn:active { transform: translateY(1px); }
                #xunketang-autoplay-scheduler-panel .btn-start { flex: 1.6; color: #fff; background: #16836a; box-shadow: 0 4px 9px #16836a1c; }
                #xunketang-autoplay-scheduler-panel .btn-start:hover:enabled { background: #106c56; }
                #xunketang-autoplay-scheduler-panel .btn-stop { flex: 1; color: #556d60; background: #fff; border-color: #dfe7df; }
                #xunketang-autoplay-scheduler-panel .btn-stop:hover:enabled { background: #eef3ee; }
                #xunketang-autoplay-scheduler-panel .action-btn:disabled { cursor: default; opacity: .45; box-shadow: none; }
                #xunketang-autoplay-scheduler-panel .log-section { border-top: 1px solid var(--line); margin-top: 19px; padding-top: 13px; }
                #xunketang-autoplay-scheduler-panel .log-title { display: flex; align-items: center; justify-content: space-between; color: #607466; font-size: 11px; cursor: pointer; list-style: none; user-select: none; }
                #xunketang-autoplay-scheduler-panel .log-title::-webkit-details-marker { display: none; }
                #xunketang-autoplay-scheduler-panel .log-title svg { transition: transform .15s; }
                #xunketang-autoplay-scheduler-panel details[open] .log-title svg { transform: rotate(180deg); }
                #xunketang-autoplay-scheduler-panel #autoplay-log-container { max-height: 145px; overflow: auto; margin-top: 10px; padding: 9px 10px; border-radius: 8px; background: #eef2ed; scrollbar-width: thin; }
                #xunketang-autoplay-scheduler-panel .log-entry { color: #5e7265; font-size: 10px; line-height: 1.7; padding: 4px 0; overflow-wrap: anywhere; border-bottom: 1px solid #dfe7dd; }
                #xunketang-autoplay-scheduler-panel .log-entry:last-child { border: 0; }
                #xunketang-autoplay-scheduler-panel .log-time { color: #7e9183; margin-right: 7px; font-variant-numeric: tabular-nums; }
                #xunketang-autoplay-scheduler-panel .panel-footnote { margin-top: 14px; color: #89988c; font-size: 9px; text-align: center; letter-spacing: .2px; }
                #xunketang-autoplay-scheduler-panel .minimized-icon { display: none; width: 54px; height: 54px; border: 0; color: #f4fff8; background: #193f35; place-items: center; }
                #xunketang-autoplay-scheduler-panel.minimized { width: 56px; height: 56px; overflow: hidden; border-radius: 18px; }
                #xunketang-autoplay-scheduler-panel.minimized .panel-content { display: none; }
                #xunketang-autoplay-scheduler-panel.minimized .minimized-icon { display: grid; }
                @media (max-width: 440px) { #xunketang-autoplay-scheduler-panel { right: 12px; top: 12px; max-height: calc(100vh - 24px); } }
                @media (prefers-reduced-motion: reduce) { #xunketang-autoplay-scheduler-panel * { transition: none !important; } }
            </style>
            <button class="minimized-icon" aria-label="展开学习助手" title="展开学习助手">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M9 5.5 18 12l-9 6.5v-13Z" fill="currentColor"/></svg>
            </button>
            <div class="panel-content">
                <div class="panel-header">
                    <div class="brand-mark"><svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M3 5.5c3-1.3 6-1 9 1v14c-3-2-6-2.3-9-1V5.5Zm18 0c-3-1.3-6-1-9 1v14c3-2 6-2.3 9-1V5.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m6 9 3 1m-3 3 3 1m6-4 3-1m-3 5 3-1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div>
                    <div class="brand-copy"><div class="panel-title">讯飞智课助手</div><div class="panel-subtitle">让学习，有条不紊。</div></div>
                    <div class="panel-controls">
                        <button class="panel-btn btn-minimize" aria-label="最小化" title="最小化">−</button>
                        <button class="panel-btn btn-close" aria-label="关闭并停止" title="关闭并停止">×</button>
                    </div>
                </div>
                <div class="panel-body">
                    <div class="status-section"><span class="status-dot" id="autoplay-status-dot"></span><span class="status-value" id="autoplay-status" role="status" aria-live="polite">准备就绪，点击开始学习</span></div>
                    <div class="resource-card">
                        <div class="card-eyebrow"><span>当前资源</span><span class="type-tag" id="autoplay-resource-kind">待识别</span></div>
                        <div class="resource-title" id="autoplay-resource-name">选择课程资源后，即可开始</div>
                        <div class="progress-heading"><span>本节完成度</span><span class="progress-percent" id="autoplay-progress-percent">0%</span></div>
                        <div class="progress-bar-container" role="progressbar" aria-label="本节完成度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-bar-fill" id="autoplay-progress-bar"></div></div>
                        <div class="progress-info" id="autoplay-progress-text">等待课程信息</div>
                    </div>
                    <div class="stats">
                        <div class="stat stat-complete"><span class="stat-number" id="autoplay-count-completed">0</span><span class="stat-label">已完成</span></div>
                        <div class="stat stat-skip"><span class="stat-number" id="autoplay-count-skipped">0</span><span class="stat-label">已跳过</span></div>
                        <div class="stat"><span class="stat-number" id="autoplay-count-total">0</span><span class="stat-label">本节资源</span></div>
                    </div>
                    <div class="button-section">
                        <button class="action-btn btn-start" id="autoplay-start-btn"><svg width="13" height="13" viewBox="0 0 16 16"><path d="m4 2 9 6-9 6V2Z" fill="currentColor"/></svg>开始学习</button>
                        <button class="action-btn btn-stop" id="autoplay-stop-btn" disabled><svg width="11" height="11" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor"/></svg>停止</button>
                    </div>
                    <details class="log-section"><summary class="log-title"><span>运行记录</span><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></summary><div id="autoplay-log-container" role="log" aria-live="off"></div></details>
                    <div class="panel-footnote">以平台确认的学习进度为准</div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        controlPanel = panel;
        statusText = document.getElementById('autoplay-status');
        progressBar = document.getElementById('autoplay-progress-bar');
        progressText = document.getElementById('autoplay-progress-text');
        startBtn = document.getElementById('autoplay-start-btn');
        stopBtn = document.getElementById('autoplay-stop-btn');
        logContainer = document.getElementById('autoplay-log-container');
        resourceText = document.getElementById('autoplay-resource-name');
        completedText = document.getElementById('autoplay-count-completed');
        totalText = document.getElementById('autoplay-count-total');
        skippedText = document.getElementById('autoplay-count-skipped');
        kindText = document.getElementById('autoplay-resource-kind');
        statusIndicator = document.getElementById('autoplay-status-dot');
        panel.querySelectorAll('button').forEach(button => { button.type = 'button'; });

        // 绑定事件
        startBtn.addEventListener('click', startAutoplay);
        stopBtn.addEventListener('click', stopAutoplay);
        panel.querySelector('.btn-minimize').addEventListener('click', toggleMinimize);
        panel.querySelector('.btn-close').addEventListener('click', () => {
            stopAutoplay();
            panel.style.display = 'none';
        });
        panel.querySelector('.minimized-icon').addEventListener('click', toggleMinimize);

        // 拖拽功能
        makeDraggable(panel, panel.querySelector('.panel-header'));
    }

    function makeDraggable(element, handle) {
        let drag = null;
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const bounds = element.getBoundingClientRect();
            drag = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
            handle.setPointerCapture(event.pointerId);
            handle.style.cursor = 'grabbing';
        });
        handle.addEventListener('pointermove', event => {
            if (!drag) return;
            const left = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, event.clientX - drag.x));
            const top = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, event.clientY - drag.y));
            element.style.left = left + 'px';
            element.style.top = top + 'px';
            element.style.right = 'auto';
        });
        const finish = () => { drag = null; handle.style.cursor = 'grab'; };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
    }

    function toggleMinimize() {
        controlPanel.classList.toggle('minimized');
    }

    function updateStatus(text, color = '#537063') {
        color = color === '#4ade80' ? '#16836a' : color === '#f87171' ? '#a1563d' : color;
        if (statusText) {
            statusText.textContent = text;
            statusText.style.color = color;
            if (statusIndicator) statusIndicator.style.background = color;
        }
    }

    function updateProgress(text, percent = -1) {
        if (progressText) progressText.textContent = text;
        if (progressBar && percent >= 0) {
            const value = Math.min(100, Math.max(0, percent));
            progressBar.style.width = value + '%';
            progressBar.parentElement?.setAttribute('aria-valuenow', String(Math.round(value)));
        }
        const percentEl = document.getElementById('autoplay-progress-percent');
        if (percentEl && percent >= 0) {
            percentEl.textContent = Math.round(percent) + '%';
        }
    }

    function addLog(message) {
        if (!logContainer) return;
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        const stamp = document.createElement('span');
        stamp.className = 'log-time';
        stamp.textContent = time;
        entry.appendChild(stamp);
        entry.appendChild(document.createTextNode(String(message)));
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;

        // 保持最多50条日志
        while (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }

    // ========== 页面元素查找 ==========

    // 获取所有本节资源列表项
    function getResourceItems() {
        return document.querySelectorAll('.activity-list-item');
    }

    // 获取当前活跃的资源项
    function getActiveResourceItem() {
        return document.querySelector('.activity-list-item.is-active');
    }

    // 判断某个资源项是否已完成
    function isItemCompleted(item) {
        const text = (item.textContent || '').replace(/\u00a0/g, ' ');
        // 老版直接显示"已完成"
        if (text.includes('已完成')) return true;
        // 新版显示"已学 65%""已学 100%"，按进度判断
        const progress = getItemProgress(item);
        if (progress === null) return false;
        return progress >= CONFIG.progressRequired;
    }

    // 解析资源项里的"已学 65%"进度（返回数字或 null）
    function getItemProgress(item) {
        const text = (item.textContent || '').replace(/\u00a0/g, ' ');
        const match = text.match(/已学\s*([\d.]+)\s*%?/);
        if (!match) return null;
        const value = parseFloat(match[1]);
        return isNaN(value) ? null : value;
    }

    // 查找"继续学习下一节"按钮
    function findNextSectionButton() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (isActionable(btn) && (text.includes('继续学习下一节') || text === '下一节')) {
                return btn;
            }
        }
        const gradientBtns = document.querySelectorAll('.el-button--gradient.btn-right');
        for (const btn of gradientBtns) {
            if (isActionable(btn) && btn.textContent.includes('下一节')) {
                return btn;
            }
        }
        // 兜底：有些入口是 div/span 做的按钮，只在叶子节点上匹配短文本
        const nodes = document.querySelectorAll('div, span, a, [role="button"]');
        for (const el of nodes) {
            if (el.children.length > 0 || !isVisible(el) || el.closest('#xunketang-autoplay-scheduler-panel')) continue;
            const text = (el.textContent || '').trim();
            if (isActionable(el) && (text === '下一节' || text === '下一章'
                || text === '继续学习下一节')) {
                return el;
            }
        }
        return null;
    }

    // 查找视频元素
    function findVideo() {
        return Array.from(document.querySelectorAll('video')).find(isVisible) || null;
    }

    // 查找播放按钮
    function findPlayButton() {
        const playBtn = document.querySelector('.xgplayer-start');
        if (playBtn) return playBtn;
        const startBtn = document.querySelector(
            '.xgplayer-icon-play, .prism-play-btn, [class*="play-btn"]'
        );
        if (startBtn) return startBtn;
        return null;
    }

    // ========== PPT元素定位（兼容旧版 #SlidePanel 与新版 .pptWrap） ==========

    // 新版结构：
    // <div class="pptWrap">
    //   <iframe class="pptIframe" src="https://owas.fifedu.com/...PowerPointFrame.aspx">
    //   <div class="btnWrap"><div class="right"><div class="toggle">
    //     <span class="pptBtn"><img class="arrow-left"></span>
    //     <span class="page">2&nbsp;/&nbsp;<span class="total">16</span></span>
    //     <span class="pptBtn"><img class="arrow-right"></span>
    //   </div></div></div>
    // </div>
    function findPptRoot() {
        return findOfficePptFrame()
            || document.querySelector('.pptWrap')
            || document.querySelector('.pptContainer')
            || document.querySelector('#SlidePanel');
    }

    function findOfficePptFrame() {
        return Array.from(document.querySelectorAll('iframe.officeweb365-iframe, iframe[src*="ow365.cn"]'))
            .find(frame => {
                try {
                    return isVisible(frame) && officeOrigin(new URL(frame.src, location.href).origin);
                } catch (error) { return false; }
            }) || null;
    }

    // 获取上一页/下一页按钮
    function getPptButtons() {
        const root = findPptRoot();
        if (!root) return { next: null, prev: null };

        const nextByIcon = root.querySelector('img.arrow-right')?.closest('.pptBtn');
        const prevByIcon = root.querySelector('img.arrow-left')?.closest('.pptBtn');
        if (nextByIcon || prevByIcon) {
            return { next: nextByIcon, prev: prevByIcon };
        }

        // 兜底：toggle 区域里最后一个 .pptBtn 是下一页
        const btns = root.querySelectorAll('.toggle .pptBtn, .btnWrap .pptBtn');
        if (btns.length >= 2) {
            return { next: btns[btns.length - 1], prev: btns[0] };
        }

        // 旧版播放器
        return {
            next: document.querySelector('#buttonNextSlide'),
            prev: document.querySelector('#buttonPrevSlide'),
        };
    }

    // 查找PPT下一页按钮
    function findNextSlideButton() {
        return getPptButtons().next;
    }

    // 查找 PDF 阅读器 iframe
    function findPdfFrame() {
        return document.querySelector('iframe[src*="pdfv-resource"]')
            || document.querySelector('iframe[src*="viewer.html"]');
    }

    // 查找"开始练习"按钮
    function findStartPracticeButton() {
        const btns = document.querySelectorAll('button.el-button--gradient.el-button--large');
        for (const btn of btns) {
            if (isActionable(btn) && btn.textContent.trim().includes('开始练习')) {
                return btn;
            }
        }
        return null;
    }

    // 查找练习页的"交卷"按钮（结构形如 <div class="text">交卷</div>，事件挂在祖先上，
    // 所以直接点击文字节点即可，click 事件会冒泡上去）
    function findSubmitPracticeButton() {
        const quick = document.querySelectorAll('div.text, span.text, .el-button');
        for (const el of quick) {
            const text = (el.textContent || '').trim();
            if (isActionable(el) && (text === '交卷' || text === '提交' || text === '提交答案')) return el;
        }
        // 兜底：全页扫叶子节点（只取叶子，避免对大容器取 textContent）
        const nodes = document.querySelectorAll('button, [role="button"], div, span, a');
        for (const el of nodes) {
            if (el.children.length > 0 || !isVisible(el) || el.closest('#xunketang-autoplay-scheduler-panel')) continue;
            const text = (el.textContent || '').trim();
            if (isActionable(el) && (text === '交卷' || text === '提交' || text === '提交答案')) return el;
        }
        return null;
    }

    // 获取PPT页码信息
    function getSlideInfo() {
        // 新版：<span class="page">2&nbsp;/&nbsp;<span class="total">16</span></span>
        const pageEl = document.querySelector('.pptWrap .page')
            || document.querySelector('.pptContainer .page');
        if (pageEl) {
            const text = (pageEl.textContent || '').replace(/\u00a0/g, ' ').trim();
            const match = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (match) {
                return { current: parseInt(match[1], 10), total: parseInt(match[2], 10) };
            }
            const totalEl = pageEl.querySelector('.total');
            const total = totalEl ? parseInt((totalEl.textContent || '').trim(), 10) : NaN;
            const current = parseInt(text, 10);
            if (!isNaN(current) && !isNaN(total)) {
                return { current: current, total: total };
            }
        }

        // 旧版：在 #SlidePanel 里找 "3 / 16" 形式的页码
        const slidePanel = document.querySelector('#SlidePanel');
        if (!slidePanel) return null;
        const pageIndicators = slidePanel.querySelectorAll(
            '[class*="page"], [class*="slide"], [id*="page"]'
        );
        for (const el of pageIndicators) {
            const text = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
            const match = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (match) {
                return { current: parseInt(match[1]), total: parseInt(match[2]) };
            }
        }
        return null;
    }

    // 点击元素（Vue 组件用 click() 即可，兜底再补一套鼠标事件）
    function clickElement(el, aggressive = false) {
        if (!el) return;
        try { el.click(); } catch (e) { /* ignore */ }
        if (!aggressive) return;
        const init = { bubbles: true, cancelable: true, view: window, composed: true };
        try { el.dispatchEvent(new PointerEvent('pointerdown', init)); } catch (e) { /* ignore */ }
        try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch (e) { /* ignore */ }
        try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch (e) { /* ignore */ }
    }

    // 按钮点不动时，用方向键兜底（部分播放器只监听键盘）
    function pressSlideNextKey() {
        const opts = {
            key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39,
            bubbles: true, cancelable: true,
        };
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', opts));
            document.dispatchEvent(new KeyboardEvent('keyup', opts));
        } catch (e) { /* ignore */ }
        const iframe = document.querySelector('.pptIframe, iframe[src*="PowerPointFrame"]');
        try {
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.dispatchEvent(new KeyboardEvent('keydown', opts));
                iframe.contentWindow.dispatchEvent(new KeyboardEvent('keyup', opts));
            }
        } catch (e) { /* 跨域忽略 */ }
    }

    // 查找 PowerPoint Online 的崩溃提示（"很抱歉,遇到问题 / 会话 ID / 重新启动"）
    // 注意：只检查叶子节点，对大容器取 textContent 会遍历整棵子树，非常耗性能
    function findPptCrashDialog() {
        const nodes = document.querySelectorAll('button, a, span, div, p, li');
        for (const el of nodes) {
            if (el.children.length > 0 || !isVisible(el) || el.closest('#xunketang-autoplay-scheduler-panel')) continue;
            const text = (el.textContent || '').trim();
            if (!text) continue;
            if (text === '重新启动') return el;
            if (text.includes('很抱歉') && text.includes('遇到问题')) return el;
        }
        return null;
    }


    // ========== 基础工具：等待都可取消，播放器 Promise 都有超时 ==========
    function log(...args) {
        if (CONFIG.debug) console.log('[讯飞调度优化版]', ...args);
        addLog(args.join(' '));
    }

    function isVisible(el) {
        return !!el && !el.closest('[hidden], [aria-hidden="true"]') && el.getClientRects().length > 0;
    }

    function isActionable(el) {
        return isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true'
            && !el.classList.contains('disabled') && !el.classList.contains('is-disabled');
    }

    function aborted() {
        return new DOMException('任务已取消', 'AbortError');
    }

    function waitForPromise(promise, signal, timeout) {
        return new Promise((resolve, reject) => {
            if (signal.aborted) return reject(aborted());
            let timer;
            const finish = (error, value) => {
                clearTimeout(timer);
                signal.removeEventListener('abort', cancel);
                if (error) reject(error);
                else resolve(value);
            };
            const cancel = () => finish(aborted());
            signal.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => finish(new Error('播放器响应超时')), timeout);
            Promise.resolve(promise).then(value => finish(null, value), finish);
        });
    }

    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal.aborted) return reject(aborted());
            const cancel = () => {
                clearTimeout(timer);
                reject(aborted());
            };
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', cancel);
                resolve();
            }, ms);
            signal.addEventListener('abort', cancel, { once: true });
        });
    }

    function pauseMedia(video) {
        try { video?.pause(); } catch (error) { /* 播放器可能已被页面移除 */ }
    }

    function uniqueId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    // ========== 讯飞适配：所有资源身份、内容识别和导航入口集中在这里 ==========
    const records = new Map();
    const playOwners = new WeakMap();
    const site = {
        sectionKey: () => location.href,
        isStudyPage: () => /\/pattern\/chapter|[?&#]chapterId=/i.test(location.href) || getResourceItems().length > 0,
        items: () => Array.from(getResourceItems()),
        active: getActiveResourceItem,
        title(item) {
            const title = item.querySelector('.activity-name, .activity-title, .title');
            return (title?.textContent || item.textContent || '')
                .replace(/已学\s*[\d.]+\s*%?/g, '').replace(/已完成|未完成/g, '')
                .replace(/\s+/g, ' ').trim();
        },
        key(item) {
            if (!item) return '';
            const id = ['data-resource-id', 'data-activity-id', 'data-id', 'id']
                .map(name => item.getAttribute(name)).find(Boolean);
            // 老页面没有 ID 时，用章节 + 顺序 + 去掉进度的标题，避免进度更新导致身份变化。
            return JSON.stringify([this.sectionKey(), id || [this.items().indexOf(item), this.title(item)]]);
        },
        record(item) {
            const key = this.key(item);
            if (!records.has(key)) records.set(key, { skipped: false, reason: '', pdfRestarts: 0, pdfReloads: 0 });
            return records.get(key);
        },
        next() {
            const items = this.items();
            const index = items.indexOf(this.active());
            const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
            return ordered.find(item => !isItemCompleted(item) && !this.record(item).skipped) || null;
        },
        snapshot() {
            const video = findVideo();
            const pptRoot = findPptRoot();
            const pdfFrame = findPdfFrame();
            const ppt = isVisible(pptRoot) ? pptRoot : null;
            const frame = isVisible(pdfFrame) ? pdfFrame : null;
            const pptFrame = findOfficePptFrame() || document.querySelector('.pptIframe, iframe[src*="PowerPointFrame"]');
            return { video, videoSrc: video?.currentSrc || video?.src || '', ppt,
                pptFrame, pptSrc: pptFrame?.src || '', frame, pdfSrc: frame?.src || '' };
        },
        type(ctx) {
            if (findVideo()) return 'video';
            if (isVisible(findPptRoot())) return 'ppt';
            if (isVisible(findPdfFrame())) return 'pdf';
            if (findStartPracticeButton() || findSubmitPracticeButton() || (ctx && ctx.state.practice.submitAt !== null)) {
                return ctx ? 'practice' : 'unknown';
            }
            return 'unknown';
        },
        counts() {
            const items = this.items();
            const completed = items.filter(isItemCompleted).length;
            const skipped = items.filter(item => !isItemCompleted(item) && this.record(item).skipped).length;
            return { total: items.length, completed, skipped };
        },
        clickResource: item => clickElement(item),
        nextSection: findNextSectionButton,
    };

    function renderProgress(ctx) {
        const { total, completed, skipped } = site.counts();
        if (resourceText) resourceText.textContent = (ctx?.item || site.active()) ? site.title(ctx?.item || site.active()) : '选择课程资源后，即可开始';
        if (completedText) completedText.textContent = completed;
        if (totalText) totalText.textContent = total;
        if (skippedText) skippedText.textContent = skipped;
        if (kindText) kindText.textContent = { video: '视频', ppt: 'PPT', pdf: 'PDF', practice: '练习' }[ctx?.type] || '待识别';
        let detail = '';
        if (ctx?.type === 'video') {
            const video = findVideo();
            if (video && Number.isFinite(video.duration) && video.duration > 0) {
                detail = ` | 视频 ${Math.round(video.currentTime / video.duration * 100)}%`;
            }
        } else if (ctx?.type === 'ppt') {
            const page = ctx.office?.info || getSlideInfo();
            if (page) {
                detail = ` | PPT ${page.current}/${page.total}`;
                if (page.animationTotal > 0) detail += ` · 动画 ${page.animationCurrent}/${page.animationTotal}`;
            }
        } else if (ctx?.type === 'pdf') detail = ' | PDF';
        else if (ctx?.type === 'practice') detail = ' | 练习';
        updateProgress(`已完成 ${completed}/${total} | 跳过 ${skipped}${detail}`, total ? completed / total * 100 : 0);
    }

    function createContext(item) {
        return {
            key: site.key(item), item, section: site.sectionKey(), token: uniqueId(),
            controller: new AbortController(), createdAt: Date.now(), type: 'unknown',
            signals: new Set(), bridge: null, snapshot: site.snapshot(),
            state: {
                video: { element: null, src: '', lastAttempt: -Infinity, lastLog: 0, endSince: null },
                ppt: { signal: '', lastChange: Date.now(), lastClick: 0, lastPage: '', clicks: 0,
                    retries: 0, retryAt: 0, noButton: 0, endSince: null, lastCrashCheck: 0 },
                practice: { startAt: null, starts: 0, submitAt: null, confirmed: false },
                pdf: { lastProgress: null, lastChange: Date.now(), endSince: null },
            },
        };
    }

    function isCurrent(run, ctx) {
        return scheduler.run === run && isRunning && !run.controller.signal.aborted
            && !ctx.controller.signal.aborted && site.sectionKey() === ctx.section
            && site.key(site.active()) === ctx.key;
    }

    function assertCurrent(run, ctx) {
        if (!isCurrent(run, ctx)) throw aborted();
    }

    function disposeContext(ctx) {
        if (!ctx) return;
        bridge.send(ctx, 'stop');
        ctx.controller.abort();
        pauseMedia(ctx.state.video.element);
    }

    // ========== iframe 消息桥：来源、当前窗口、资源会话、加载批次都必须一致 ==========
    const CHANNEL = 'xunketang.scheduler.v1';
    function trustedOrigin(origin) {
        try {
            const url = new URL(origin);
            return /^https?:$/.test(url.protocol)
                && /(^|\.)(fifedu\.com|xunketang\.com)$/.test(url.hostname);
        } catch (error) { return false; }
    }

    const bridge = {
        connect(ctx, frame, kind) {
            if (!frame?.contentWindow) return;
            const origin = new URL(frame.src, location.href).origin;
            if (!trustedOrigin(origin)) return;
            if (!ctx.bridge || ctx.bridge.frame !== frame || ctx.bridge.src !== frame.src) {
                this.send(ctx, 'stop');
                const link = { frame, window: frame.contentWindow, src: frame.src, origin,
                    kind, nonce: uniqueId(), helperId: null };
                ctx.bridge = link;
                frame.addEventListener('load', () => {
                    if (ctx.controller.signal.aborted || ctx.bridge !== link) return;
                    // WindowProxy 在 iframe 重载后可能不变，因此每次 load 都更换批次编号。
                    link.nonce = uniqueId();
                    link.helperId = null;
                    this.send(ctx, 'bind');
                }, { signal: ctx.controller.signal });
            }
            this.send(ctx, 'bind');
            this.send(ctx, 'start');
        },
        send(ctx, type) {
            const link = ctx?.bridge;
            if (!link) return;
            try {
                link.window.postMessage({ channel: CHANNEL, type, session: ctx.token,
                    nonce: link.nonce, kind: link.kind }, link.origin);
            } catch (error) { log(`阅读器消息发送失败：${error.message}`); }
        },
        receive(event) {
            if (officePpt.receive(event)) return;
            const run = scheduler.run;
            const ctx = run?.context;
            const data = event.data;
            const link = ctx?.bridge;
            if (!ctx || !link || !isCurrent(run, ctx) || !data || data.channel !== CHANNEL
                || event.source !== link.window || event.origin !== link.origin
                || data.session !== ctx.token || data.nonce !== link.nonce || data.kind !== link.kind) return;
            if (data.type === 'ready' && typeof data.helperId === 'string') link.helperId = data.helperId;
            else if (typeof link.helperId === 'string' && data.helperId === link.helperId
                && ['ppt-crash', 'pdf-error', 'pdf-end'].includes(data.type)) {
                if ((data.type === 'ppt-crash' && ctx.type !== 'ppt')
                    || (data.type.startsWith('pdf-') && ctx.type !== 'pdf')) return;
                ctx.signals.add(data.type);
                scheduler.wake();
            }
        },
    };

    // ========== 资源处理器：只返回结果，不直接切换资源 ==========
    // action：wait 继续等待；skip 请求跳过；reload 请求重载；blocked 停止并说明原因。
    const result = (action = 'wait', reason = '', delay = CONFIG.checkInterval) => ({ action, reason, delay });

    // OfficeWeb365 使用播放器本身的字符串消息协议，不向其发送自定义对象，
    // 也不需要在 ow365.cn 上额外注入脚本。nextAnim 会先推进同页动画，再自然翻页。
    function officeOrigin(origin) {
        try {
            const url = new URL(origin);
            return /^https?:$/.test(url.protocol) && /(^|\.)ow365\.cn$/.test(url.hostname);
        } catch (error) { return false; }
    }

    const officePpt = {
        connect(ctx, frame) {
            const origin = new URL(frame.src, location.href).origin;
            if (!officeOrigin(origin) || !frame.contentWindow) return null;
            if (!ctx.office || ctx.office.frame !== frame || ctx.office.src !== frame.src) {
                const link = { frame, window: frame.contentWindow, origin, src: frame.src,
                    info: null, receivedAt: null, requestedAt: null, connectedAt: Date.now(), pending: null };
                ctx.office = link;
                frame.addEventListener('load', () => {
                    if (ctx.controller.signal.aborted || ctx.office !== link) return;
                    link.info = null;
                    link.pending = null;
                    link.receivedAt = null;
                    link.requestedAt = null;
                    link.connectedAt = Date.now();
                    scheduler.wake();
                }, { signal: ctx.controller.signal });
                log('📑 已识别 OfficeWeb365 PPT，正在读取页码与动画状态');
            }
            const link = ctx.office;
            if (link.requestedAt === null || Date.now() - link.requestedAt >= CONFIG.checkInterval) {
                this.send(ctx, 'pageAnim');
            }
            return link;
        },
        send(ctx, command) {
            const link = ctx.office;
            if (!link || ctx.controller.signal.aborted || !['pageAnim', 'nextAnim'].includes(command)) return;
            if (command === 'pageAnim') link.requestedAt = Date.now();
            link.window.postMessage(command, link.origin);
        },
        receive(event) {
            const run = scheduler.run;
            const ctx = run?.context;
            const link = ctx?.office;
            if (!ctx || ctx.type !== 'ppt' || !link || !isCurrent(run, ctx)
                || event.source !== link.window || event.origin !== link.origin
                || findOfficePptFrame() !== link.frame || link.frame.src !== link.src
                || link.requestedAt === null) return false;
            let data = event.data;
            if (typeof data === 'string') {
                if (data.length > 200000) return false;
                try { data = JSON.parse(data); } catch (error) { return false; }
            }
            if (!data || data.info !== 'ow365' || !data.page || !data.anim) return false;
            const number = value => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))
                ? Number(value) : NaN;
            const info = { current: number(data.page.idx), total: number(data.page.total),
                animationCurrent: number(data.anim.idx), animationTotal: number(data.anim.total) };
            if (!Object.values(info).every(Number.isSafeInteger) || info.current < 1 || info.total < info.current
                || info.total > 10000 || info.animationCurrent < 0 || info.animationTotal < info.animationCurrent
                || info.animationTotal > 100000) return false;
            // 播放器会回传自身 URL；只用于比对，不保存或输出带签名的资源地址。
            if (data.url) {
                try { if (new URL(data.url).href !== new URL(link.src).href) return false; }
                catch (error) { return false; }
            }
            const signature = `${info.current}/${info.total}#${info.animationCurrent}/${info.animationTotal}`;
            const previous = link.info;
            const previousSignature = previous
                ? `${previous.current}/${previous.total}#${previous.animationCurrent}/${previous.animationTotal}` : '';
            link.info = info;
            link.receivedAt = Date.now();
            if (signature !== previousSignature) {
                link.pending = null;
                ctx.state.ppt.lastChange = Date.now();
                ctx.state.ppt.retries = 0;
                log(`📄 PPT ${info.current}/${info.total}，动画 ${info.animationCurrent}/${info.animationTotal}`);
            }
            scheduler.wake();
            return true;
        },
    };

    function processOfficePpt(run, ctx, frame) {
        const state = ctx.state.ppt;
        const link = officePpt.connect(ctx, frame);
        const now = Date.now();
        if (!link || !link.info) {
            if (now - (link?.connectedAt ?? ctx.createdAt) >= CONFIG.resourceLoadTimeout) {
                return result('blocked', 'OfficeWeb365 未返回页码，请等待播放器加载后重试');
            }
            return result('wait', '', CONFIG.pptTickInterval);
        }
        const page = link.info;
        if (page.current >= page.total && page.animationCurrent >= page.animationTotal) {
            if (state.endSince === null) {
                state.endSince = now;
                log('⏳ PPT 最后一页及动画已结束，等待站点确认进度');
            }
            return now - state.endSince >= CONFIG.progressConfirmWait
                ? result('blocked', 'PPT 已阅读到末尾，但站点未确认完成') : result();
        }
        state.endSince = null;
        if (state.clicks >= CONFIG.maxSlideClicks) return result('blocked', 'PPT 操作次数已达上限，请手动检查');
        if (now - link.receivedAt >= CONFIG.slideStuckTimeout) {
            return result('blocked', 'OfficeWeb365 状态通知中断，请检查播放器是否正常');
        }
        const stuck = now - state.lastChange >= CONFIG.slideStuckTimeout;
        if (stuck && state.retries >= CONFIG.pptRetryLimit) {
            return result('blocked', 'PPT 多次推进仍无变化，请手动检查');
        }
        if (stuck && now < state.retryAt) return result('wait', '', CONFIG.pptTickInterval);
        if (!stuck && link.pending) return result('wait', '', CONFIG.pptTickInterval);
        const pageKey = `${page.current}/${page.total}`;
        const delay = pageKey !== state.lastPage ? CONFIG.slideIntervalPage : CONFIG.slideIntervalAnim;
        if (now - state.lastClick < delay) return result('wait', '', CONFIG.pptTickInterval);
        if (stuck) {
            state.retries++;
            state.retryAt = now + CONFIG.slideRetryInterval;
            log(`🔁 PPT 未推进，重试 ${state.retries}/${CONFIG.pptRetryLimit}`);
        }
        state.lastClick = now;
        state.lastPage = pageKey;
        state.clicks++;
        link.pending = { sentAt: now };
        officePpt.send(ctx, 'nextAnim');
        return result('wait', '', CONFIG.pptTickInterval);
    }

    async function processVideo(run, ctx) {
        const video = findVideo();
        if (!video) return result();
        const state = ctx.state.video;
        const src = video.currentSrc || video.src;
        if (state.element !== video || state.src !== src) {
            state.element = video;
            state.src = src;
            state.lastAttempt = -Infinity;
            state.endSince = null;
            log(`🎬 处理视频：${site.title(ctx.item)}`);
        }
        if (CONFIG.autoMute) video.muted = true;
        if (video.playbackRate !== CONFIG.playbackRate) video.playbackRate = CONFIG.playbackRate;
        if (video.ended) {
            if (state.endSince === null) state.endSince = Date.now();
            if (Date.now() - state.endSince >= CONFIG.progressConfirmWait) {
                return result('blocked', '视频已结束，但站点未确认完成，请检查进度后重新开始');
            }
            return result();
        }
        state.endSince = null;
        if (video.paused && Date.now() - state.lastAttempt >= CONFIG.videoRetryInterval) {
            state.lastAttempt = Date.now();
            assertCurrent(run, ctx);
            const button = findPlayButton();
            if (isActionable(button)) {
                button.click();
                await sleep(500, ctx.controller.signal);
                assertCurrent(run, ctx);
            }
            if (findVideo() !== video || (video.currentSrc || video.src) !== src) return result();
            if (video.paused) {
                playOwners.set(video, ctx.token);
                // play() 无法真正取消；迟到的完成回调只允许清理自己拥有的播放器。
                const promise = Promise.resolve(video.play());
                promise.then(() => {
                    const stale = !isCurrent(run, ctx) || findVideo() !== video
                        || (video.currentSrc || video.src) !== src;
                    if (stale && playOwners.get(video) === ctx.token) pauseMedia(video);
                }, () => {});
                try { await waitForPromise(promise, ctx.controller.signal, CONFIG.mediaPlayTimeout); }
                catch (error) {
                    if (error.name === 'AbortError') throw error;
                    assertCurrent(run, ctx);
                    log(`⚠️ 视频暂时无法播放：${error.message}，稍后重试`);
                }
                assertCurrent(run, ctx);
            }
        }
        if (Date.now() - state.lastLog >= 30000) {
            state.lastLog = Date.now();
            log(`📊 视频状态：${video.paused ? '暂停' : '播放中'}，站点进度 ${getItemProgress(ctx.item) ?? '未知'}%`);
        }
        return result();
    }

    function processPpt(run, ctx) {
        const officeFrame = findOfficePptFrame();
        if (officeFrame) return processOfficePpt(run, ctx, officeFrame);
        const state = ctx.state.ppt;
        const now = Date.now();
        const frame = document.querySelector('.pptIframe, iframe[src*="PowerPointFrame"]');
        bridge.connect(ctx, frame, 'ppt');
        if (CONFIG.skipResourceOnPptCrash) {
            if (ctx.signals.delete('ppt-crash')) return result('skip', 'PPT 播放器崩溃');
            if (now - state.lastCrashCheck >= 10000) {
                state.lastCrashCheck = now;
                if (findPptCrashDialog()) return result('skip', 'PPT 播放器崩溃');
            }
        }
        const page = getSlideInfo();
        const pageKey = page ? `${page.current}/${page.total}` : '';
        const progress = getItemProgress(ctx.item);
        const signal = `${pageKey}#${progress}`;
        if (signal !== state.signal) {
            state.signal = signal;
            state.lastChange = now;
            state.retries = 0;
        }
        const next = findNextSlideButton();
        const newViewer = !!document.querySelector('.pptWrap, .pptContainer');
        state.noButton = !newViewer && !page && !next ? state.noButton + 1 : 0;
        const atEnd = (page && page.total > 0 && page.current >= page.total)
            || (next && (next.disabled || next.classList.contains('disabled'))) || state.noButton >= 3;
        if (atEnd) {
            if (state.endSince === null) {
                state.endSince = now;
                log('⏳ PPT 到达末尾，等待站点确认进度');
            }
            if (now - state.endSince >= CONFIG.progressConfirmWait) {
                return result('blocked', 'PPT 到达末尾，但站点未确认完成，请检查进度');
            }
            return result();
        }
        state.endSince = null;
        // 点击和方向键共享同一个上限，卡住分支也不能绕过保险丝。
        if (state.clicks >= CONFIG.maxSlideClicks) return result('blocked', 'PPT 操作次数已达上限，请手动检查');
        if (now - state.lastChange >= CONFIG.slideStuckTimeout) {
            if (state.retries >= CONFIG.pptRetryLimit) return result('blocked', 'PPT 多次恢复仍无变化，请手动检查');
            if (now >= state.retryAt) {
                state.retries++;
                state.clicks++;
                state.retryAt = now + CONFIG.slideRetryInterval;
                pressSlideNextKey();
                log(`🔁 PPT 卡住，方向键恢复 ${state.retries}/${CONFIG.pptRetryLimit}`);
            }
            return result('wait', '', CONFIG.pptTickInterval);
        }
        const advanced = !!pageKey && pageKey !== state.lastPage;
        const delay = advanced ? CONFIG.slideIntervalPage : CONFIG.slideIntervalAnim;
        if (now - state.lastClick >= delay) {
            state.lastClick = now;
            state.lastPage = pageKey;
            state.clicks++;
            if (next) clickElement(next);
            else pressSlideNextKey();
        }
        return result('wait', '', CONFIG.pptTickInterval);
    }

    function confirmPractice(ctx) {
        const state = ctx.state.practice;
        if (state.confirmed) return;
        for (const box of document.querySelectorAll('.el-message-box, .el-dialog')) {
            if (!isVisible(box) || !/交卷|提交|作答|确定要|确认要/.test(box.textContent || '')) continue;
            for (const button of box.querySelectorAll('button')) {
                if (isActionable(button) && /^(确定|确认|继续|交卷)$/.test(button.textContent.trim())) {
                    button.click();
                    state.confirmed = true;
                    log('✅ 已确认交卷，等待站点更新进度');
                    return;
                }
            }
        }
    }

    function processPractice(run, ctx) {
        const state = ctx.state.practice;
        const now = Date.now();
        // 一旦发起交卷，固定等待起点，不因按钮仍在页面上而不断重新计时。
        if (state.submitAt !== null) {
            confirmPractice(ctx);
            if (now - state.submitAt >= CONFIG.practiceSubmitWait) {
                return result(CONFIG.skipPracticeIfNotMarked ? 'skip' : 'blocked', '练习已发起交卷，但站点未确认完成');
            }
            return result();
        }
        const start = findStartPracticeButton();
        if (start) {
            if (state.startAt === null || now - state.startAt >= 5000) {
                if (state.starts >= 3) return result('blocked', '练习入口多次点击仍未打开');
                state.starts++;
                state.startAt = now;
                start.click();
                log('📝 已点击开始练习');
            }
            return result();
        }
        const submit = findSubmitPracticeButton();
        if (submit) {
            state.submitAt = now;
            submit.click();
            log('📝 已发起交卷');
        } else if (now - ctx.createdAt >= CONFIG.resourceLoadTimeout) {
            return result('blocked', '练习页面未出现可用操作，请手动检查');
        }
        return result();
    }

    function processPdf(run, ctx) {
        const state = ctx.state.pdf;
        const record = site.record(ctx.item);
        bridge.connect(ctx, findPdfFrame(), 'pdf');
        const now = Date.now();
        if (ctx.signals.delete('pdf-end') && state.endSince === null) {
            state.endSince = now;
            log('⏳ PDF 阅读器已到末尾，等待站点确认进度');
        }
        if (state.endSince !== null && now - state.endSince >= CONFIG.progressConfirmWait) {
            return result('blocked', 'PDF 已到末尾，但站点未确认完成');
        }
        if (state.endSince !== null && !ctx.signals.has('pdf-error')) return result();
        const progress = getItemProgress(ctx.item);
        if (progress !== state.lastProgress) {
            state.lastProgress = progress;
            state.lastChange = now;
        }
        if (ctx.signals.delete('pdf-error')) {
            if (record.pdfReloads >= 2) return result('blocked', 'PDF 多次重载仍未渲染出内容');
            record.pdfReloads++;
            return result('reload', `PDF 未渲染出内容，重载 ${record.pdfReloads}/2`);
        }
        if (now - state.lastChange < CONFIG.pdfStuckTimeout) return result();
        state.lastChange = now;
        if (record.pdfRestarts < 5) {
            record.pdfRestarts++;
            state.endSince = null;
            bridge.send(ctx, 'restart');
            log(`🔁 PDF 进度停滞，从头阅读 ${record.pdfRestarts}/5`);
        } else if (record.pdfReloads < 2) {
            record.pdfReloads++;
            return result('reload', `PDF 进度停滞，重载 ${record.pdfReloads}/2`);
        } else return result('blocked', 'PDF 恢复次数已达上限，请手动检查');
        return result();
    }

    const handlers = { video: processVideo, ppt: processPpt, pdf: processPdf, practice: processPractice };

    // ========== 调度器：唯一决定资源切换的位置，同一轮绝不并行执行 ==========
    const scheduler = {
        run: null,
        start() {
            if (isRunning) return;
            const run = { controller: new AbortController(), context: null, timer: null,
                due: Infinity, busy: false, pending: false, navigation: null,
                section: site.sectionKey(), emptySince: null, lastSectionClick: -Infinity };
            this.run = run;
            isRunning = true;
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            updateStatus('运行中', '#4ade80');
            log('🚀 调度器已启动');
            this.wake();
        },
        stop(reason = '已停止') {
            const run = this.run;
            if (!run) return;
            this.run = null;
            isRunning = false;
            clearTimeout(run.timer);
            run.controller.abort();
            run.navigation?.controller.abort();
            disposeContext(run.context);
            pauseMedia(findVideo());
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            updateStatus(reason, reason === '已停止' ? '#76847e' : '#f87171');
            log(`⏹ ${reason}`);
        },
        wake(delay = 0) {
            const run = this.run;
            if (!run || !isRunning) return;
            if (run.busy) { run.pending = true; return; }
            const due = Date.now() + delay;
            if (run.timer !== null && run.due <= due) return;
            clearTimeout(run.timer);
            run.due = due;
            run.timer = setTimeout(() => {
                run.timer = null;
                run.due = Infinity;
                void this.pump(run);
            }, delay);
        },
        async pump(run) {
            if (this.run !== run || !isRunning || run.busy) return;
            run.busy = true;
            run.pending = false;
            let delay = CONFIG.checkInterval;
            try { delay = await this.tick(run); }
            catch (error) {
                if (error.name !== 'AbortError' && this.run === run) {
                    this.stop(`发生错误：${error.message}`);
                    console.error('[讯飞调度优化版]', error);
                }
            } finally {
                run.busy = false;
                if (this.run === run && isRunning) this.wake(run.pending ? 0 : delay);
            }
        },
        pageChanged() {
            const run = this.run;
            if (!run) return;
            if (run.context && !isCurrent(run, run.context)) run.context.controller.abort();
            this.wake();
        },
        navigate(run, item, reason = '', reload = false, manual = false) {
            const previous = run.context?.snapshot || site.snapshot();
            disposeContext(run.context);
            run.context = null;
            run.navigation?.controller.abort();
            const target = item || site.nextSection();
            if (!target) {
                const counts = site.counts();
                renderProgress(null);
                this.stop(`本节已完成 ${counts.completed}/${counts.total}，跳过 ${counts.skipped}；未找到下一节`);
                return;
            }
            const now = Date.now();
            const navigation = { key: item ? site.key(item) : null, section: site.sectionKey(),
                list: site.items().map(entry => site.key(entry)).join('|'), previous,
                readyAt: now + CONFIG.switchWait, expiresAt: now + Math.max(CONFIG.switchTimeout, CONFIG.switchWait + 1000),
                reload, loaded: new Set(), controller: new AbortController() };
            run.navigation = navigation;
            for (const frame of [previous.frame, previous.pptFrame].filter(Boolean)) {
                frame.addEventListener('load', () => {
                    if (this.run === run && run.navigation === navigation) {
                        navigation.loaded.add(frame);
                        this.wake();
                    }
                }, { once: true, signal: navigation.controller.signal });
            }
            updateStatus('正在切换资源…');
            if (!manual) {
                log(`👉 ${reason || (item ? `切换资源：${site.title(item)}` : '进入下一节')}`);
                if (item) site.clickResource(target);
                else { run.lastSectionClick = now; clickElement(target); }
            }
        },
        navigationReady(run) {
            const nav = run.navigation;
            const now = Date.now();
            const active = site.active();
            const view = site.snapshot();
            let changed;
            if (nav.key) {
                changed = site.key(active) === nav.key;
            } else {
                changed = site.sectionKey() !== nav.section
                    || site.items().map(entry => site.key(entry)).join('|') !== nav.list;
            }
            // 列表先变、播放器后变时，禁止操作残留的旧内容（包括跨章节切换）。
            if (view.video && view.video === nav.previous.video && view.videoSrc === nav.previous.videoSrc) changed = false;
            if (view.frame && view.frame === nav.previous.frame && !nav.loaded.has(view.frame)) changed = false;
            if (!view.video && view.ppt && view.ppt === nav.previous.ppt && view.pptFrame
                && view.pptFrame === nav.previous.pptFrame && !nav.loaded.has(view.pptFrame)) changed = false;
            if (now >= nav.readyAt && changed) {
                nav.controller.abort();
                run.navigation = null;
                run.emptySince = null;
                return true;
            }
            if (now >= nav.expiresAt) this.stop('资源切换未确认，请检查页面后重新开始');
            return false;
        },
        async tick(run) {
            if (this.run !== run || !isRunning) return CONFIG.checkInterval;
            if (run.navigation && !this.navigationReady(run)) return CONFIG.pptTickInterval;
            if (site.sectionKey() !== run.section) {
                if (run.context && site.isStudyPage() && site.active()) {
                    this.navigate(run, site.active(), '', false, true);
                    run.section = site.sectionKey();
                    return CONFIG.pptTickInterval;
                }
                disposeContext(run.context);
                run.context = null;
                run.section = site.sectionKey();
                run.emptySince = null;
            }
            if (!site.isStudyPage()) {
                updateStatus('等待进入章节学习页');
                return CONFIG.checkInterval;
            }
            const items = site.items();
            const item = site.active();
            if (!items.length) {
                disposeContext(run.context);
                run.context = null;
                renderProgress(null);
                if (run.emptySince === null) run.emptySince = Date.now();
                if (Date.now() - run.emptySince >= CONFIG.emptySectionWait
                    && Date.now() - run.lastSectionClick >= CONFIG.emptySectionCooldown) this.navigate(run, null);
                return CONFIG.checkInterval;
            }
            run.emptySince = null;
            if (!item) {
                if (site.next()) this.navigate(run, site.next());
                else this.navigate(run, null);
                return CONFIG.checkInterval;
            }
            if (run.context && run.context.key !== site.key(item)) {
                this.navigate(run, item, '', false, true);
                return CONFIG.pptTickInterval;
            }
            if (!run.context || run.context.controller.signal.aborted) run.context = createContext(item);
            const ctx = run.context;
            ctx.item = item; // DOM 重建但资源 ID 不变时，保留该资源的处理状态。
            if (isItemCompleted(item) || site.record(item).skipped) {
                this.navigate(run, site.next());
                return CONFIG.checkInterval;
            }
            ctx.type = site.type(ctx);
            ctx.snapshot = site.snapshot();
            updateStatus({ video: '正在播放视频', ppt: '正在阅读 PPT', pdf: '正在阅读 PDF',
                practice: '正在处理练习', unknown: '等待课程内容加载' }[ctx.type], '#4ade80');
            renderProgress(ctx);
            // 只关闭通知，不再一律关闭业务对话框，以免取消交卷或登录提示。
            for (const button of document.querySelectorAll('.el-notification__closeBtn')) {
                if (isActionable(button)) button.click();
            }
            const handler = handlers[ctx.type];
            const outcome = handler ? await handler(run, ctx)
                : Date.now() - ctx.createdAt >= CONFIG.resourceLoadTimeout
                    ? result('blocked', '资源类型无法识别，请手动检查') : result();
            assertCurrent(run, ctx);
            if (outcome.action === 'skip') {
                Object.assign(site.record(item), { skipped: true, reason: outcome.reason });
                log(`⏭ 跳过：${site.title(item)}；${outcome.reason}`);
                this.navigate(run, site.next());
            } else if (outcome.action === 'reload') {
                // 同 URL 的 iframe 重载用 load 事件确认，次数保存在资源记录而非新上下文中。
                this.navigate(run, item, outcome.reason, true);
            } else if (outcome.action === 'blocked') this.stop(outcome.reason);
            return outcome.delay;
        },
    };

    function startAutoplay() { scheduler.start(); }
    function stopAutoplay() { scheduler.stop(); }

    // ========== 阅读器辅助实例：只接受当前顶层页面绑定的会话 ==========
    function runViewerHelper(kind) {
        const helperId = uniqueId();
        let binding = null;
        let enabled = false;
        let reachedEnd = false;
        let startedAt = null;
        let lastAction = 0;
        let errorReported = false;
        let crashReported = false;
        const send = type => {
            if (!binding) return;
            window.top.postMessage({ channel: CHANNEL, kind, type, helperId,
                session: binding.session, nonce: binding.nonce }, binding.origin);
        };
        const reset = () => {
            reachedEnd = false;
            startedAt = null;
            lastAction = 0;
            errorReported = false;
            crashReported = false;
        };
        const receive = event => {
            const data = event.data;
            if (event.source !== window.top || !trustedOrigin(event.origin) || !data
                || data.channel !== CHANNEL || data.kind !== kind
                || typeof data.session !== 'string' || typeof data.nonce !== 'string') return;
            if (data.type === 'bind') {
                if (!binding || binding.session !== data.session || binding.nonce !== data.nonce) {
                    reset();
                    enabled = false;
                    binding = { origin: event.origin, session: data.session, nonce: data.nonce };
                }
                send('ready');
                return;
            }
            if (!binding || event.origin !== binding.origin || data.session !== binding.session || data.nonce !== binding.nonce) return;
            if (data.type === 'stop') enabled = false;
            else if (data.type === 'restart') {
                reset();
                const box = document.getElementById('viewerContainer') || document.scrollingElement;
                if (box) box.scrollTop = 0;
                const app = window.PDFViewerApplication;
                if (app?.pdfViewer) app.pdfViewer.currentPageNumber = 1;
                enabled = true;
                startedAt = Date.now();
            } else if (data.type === 'start' && !reachedEnd) {
                enabled = true;
                if (startedAt === null) startedAt = Date.now();
            }
        };
        window.addEventListener('message', receive);
        const timer = setInterval(() => {
            if (!enabled) return;
            const now = Date.now();
            if (kind === 'ppt') {
                if (CONFIG.skipResourceOnPptCrash && !crashReported && findPptCrashDialog()) {
                    crashReported = true;
                    send('ppt-crash');
                }
                return;
            }
            if (!errorReported && startedAt !== null && now - startedAt >= 20000
                && document.querySelectorAll('.page').length === 0) {
                errorReported = true;
                send('pdf-error');
            }
            const box = document.getElementById('viewerContainer') || document.scrollingElement;
            if (!box || !box.clientHeight || document.querySelectorAll('.page').length === 0
                || now - lastAction < CONFIG.pdfScrollInterval) return;
            lastAction = now;
            const app = window.PDFViewerApplication;
            const current = Number(app?.pdfViewer?.currentPageNumber || document.getElementById('pageNumber')?.value);
            const total = Number(app?.pagesCount || document.getElementById('numPages')?.textContent?.replace(/[^\d]/g, ''));
            const bottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
            if (bottom) {
                const next = document.getElementById('next');
                // 单页模式滚动到底也可能还有下一页，先尝试阅读器的翻页入口。
                if ((!total || !current || current < total) && isActionable(next)) {
                    next.click();
                    return;
                }
                if (total && current && current < total) return;
                reachedEnd = true;
                enabled = false;
                send('pdf-end');
                return;
            }
            const before = box.scrollTop;
            box.scrollTop += Math.max(200, box.clientHeight * CONFIG.pdfScrollStep);
            if (box.scrollTop === before) {
                const next = document.getElementById('next');
                if (isActionable(next)) next.click();
            }
        }, kind === 'ppt' ? 5000 : 500);
        window.addEventListener('pagehide', () => {
            enabled = false;
            clearInterval(timer);
            window.removeEventListener('message', receive);
        }, { once: true });
    }

    // ========== 启动：事件只唤醒调度器，统一在 tick 中执行操作 ==========
    function boot() {
        if (window.top !== window.self) {
            if (/pdfv-resource|viewer\.html/i.test(location.href) || document.getElementById('viewerContainer')) {
                runViewerHelper('pdf');
            } else if (/PowerPointFrame|owas\.fifedu\.com/i.test(location.href)) runViewerHelper('ppt');
            return;
        }
        createControlPanel();
        log('讯飞智课调度优化版 v4.0.1 已加载，请点击开始');
        renderProgress(null);
        window.addEventListener('message', event => bridge.receive(event));
        // ended 不冒泡，使用捕获阶段监听。
        document.addEventListener('ended', event => {
            if (event.target?.tagName === 'VIDEO') scheduler.wake();
        }, true);
        let lastObserved = 0;
        const observer = new MutationObserver(mutations => {
            const relevant = mutations.some(change => !controlPanel?.contains(change.target));
            if (!relevant || !isRunning || Date.now() - lastObserved < 300) return;
            lastObserved = Date.now();
            scheduler.pageChanged();
        });
        observer.observe(document.body, { childList: true, subtree: true,
            attributes: true, attributeFilter: ['src', 'class'], characterData: true });
        window.addEventListener('hashchange', () => scheduler.pageChanged());
        window.addEventListener('popstate', () => scheduler.pageChanged());
        window.addEventListener('pagehide', () => {
            scheduler.stop('页面已离开');
            observer.disconnect();
        }, { once: true });
    }

    boot();
})();
