// ==UserScript==
// @name         讯飞智课自动刷课脚本
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  自动播放讯飞智课视频/PPT，完成后自动切换下一个，全部完成自动下一节
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
        // 是否自动处理 PowerPoint Online 崩溃弹窗
        autoRestartPptViewer: true,
        // PPT多久没有任何变化算卡住（毫秒）
        slideStuckTimeout: 30000,
        // 卡住后每隔多久重试一次（毫秒）
        slideRetryInterval: 20000,
        // 内容切换等待时间（毫秒）
        switchWait: 3000,
        // 资源完成所需的进度百分比（站点保存进度要求，常见为 90）
        progressRequired: 90,
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
    let mainInterval = null;
    let pptInterval = null;

    // ========== 悬浮窗UI ==========
    function createControlPanel() {
        // 只在整个页面里注入一份面板，避免 iframe 里出现多个重复面板
        if (window.top !== window.self) return;

        const panel = document.createElement('div');
        panel.id = 'xunketang-autoplay-panel';
        panel.innerHTML = `
            <style>
                #xunketang-autoplay-panel {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 320px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #fff;
                    overflow: hidden;
                    transition: all 0.3s ease;
                }
                #xunketang-autoplay-panel.minimized {
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    cursor: pointer;
                }
                #xunketang-autoplay-panel.minimized .panel-content {
                    display: none;
                }
                #xunketang-autoplay-panel.minimized .minimized-icon {
                    display: flex;
                }
                .minimized-icon {
                    display: none;
                    width: 100%;
                    height: 100%;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                }
                .panel-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    background: rgba(0,0,0,0.2);
                    cursor: move;
                }
                .panel-title {
                    font-size: 14px;
                    font-weight: 600;
                }
                .panel-controls {
                    display: flex;
                    gap: 8px;
                }
                .panel-btn {
                    width: 24px;
                    height: 24px;
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    transition: transform 0.2s;
                }
                .panel-btn:hover {
                    transform: scale(1.1);
                }
                .btn-minimize {
                    background: #ffd93d;
                    color: #333;
                }
                .btn-close {
                    background: #ff6b6b;
                    color: #fff;
                }
                .panel-content {
                    padding: 16px;
                }
                .status-section {
                    margin-bottom: 12px;
                }
                .status-label {
                    font-size: 11px;
                    opacity: 0.8;
                    margin-bottom: 4px;
                }
                .status-value {
                    font-size: 13px;
                    font-weight: 500;
                }
                .progress-section {
                    margin-bottom: 16px;
                }
                .progress-bar-container {
                    width: 100%;
                    height: 8px;
                    background: rgba(255,255,255,0.2);
                    border-radius: 4px;
                    overflow: hidden;
                    margin-top: 6px;
                }
                .progress-bar-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #4ade80, #22c55e);
                    border-radius: 4px;
                    transition: width 0.3s ease;
                    width: 0%;
                }
                .progress-info {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 4px;
                    font-size: 11px;
                    opacity: 0.9;
                }
                .button-section {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 12px;
                }
                .action-btn {
                    flex: 1;
                    padding: 10px;
                    border: none;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .action-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                }
                .action-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    transform: none;
                }
                .btn-start {
                    background: linear-gradient(135deg, #4ade80, #22c55e);
                    color: #fff;
                }
                .btn-stop {
                    background: linear-gradient(135deg, #f87171, #ef4444);
                    color: #fff;
                }
                .log-section {
                    background: rgba(0,0,0,0.2);
                    border-radius: 8px;
                    padding: 10px;
                    max-height: 120px;
                    overflow-y: auto;
                }
                .log-title {
                    font-size: 11px;
                    opacity: 0.8;
                    margin-bottom: 6px;
                }
                .log-entry {
                    font-size: 11px;
                    line-height: 1.4;
                    padding: 2px 0;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .log-entry:last-child {
                    border-bottom: none;
                }
                .log-time {
                    opacity: 0.6;
                    margin-right: 6px;
                }
            </style>
            <div class="minimized-icon">▶</div>
            <div class="panel-content">
                <div class="panel-header">
                    <span class="panel-title">🎓 讯飞智课助手</span>
                    <div class="panel-controls">
                        <button class="panel-btn btn-minimize" title="最小化">−</button>
                        <button class="panel-btn btn-close" title="关闭">×</button>
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-label">运行状态</div>
                    <div class="status-value" id="autoplay-status">已停止</div>
                </div>
                <div class="progress-section">
                    <div class="status-label">当前进度</div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" id="autoplay-progress-bar"></div>
                    </div>
                    <div class="progress-info">
                        <span id="autoplay-progress-text">等待开始...</span>
                        <span id="autoplay-progress-percent">0%</span>
                    </div>
                </div>
                <div class="button-section">
                    <button class="action-btn btn-start" id="autoplay-start-btn">▶ 开始</button>
                    <button class="action-btn btn-stop" id="autoplay-stop-btn" disabled>⏹ 停止</button>
                </div>
                <div class="log-section">
                    <div class="log-title">📋 运行日志</div>
                    <div id="autoplay-log-container"></div>
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
        let isDragging = false;
        let offsetX, offsetY;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - element.getBoundingClientRect().left;
            offsetY = e.clientY - element.getBoundingClientRect().top;
            element.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const x = e.clientX - offsetX;
            const y = e.clientY - offsetY;
            element.style.left = x + 'px';
            element.style.top = y + 'px';
            element.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            element.style.transition = 'all 0.3s ease';
        });
    }

    function toggleMinimize() {
        controlPanel.classList.toggle('minimized');
    }

    function updateStatus(text, color = '#fff') {
        if (statusText) {
            statusText.textContent = text;
            statusText.style.color = color;
        }
    }

    function updateProgress(text, percent = -1) {
        if (progressText) progressText.textContent = text;
        if (progressBar && percent >= 0) {
            progressBar.style.width = Math.min(100, Math.max(0, percent)) + '%';
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
        entry.innerHTML = `<span class="log-time">${time}</span>${message}`;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;

        // 保持最多50条日志
        while (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }

    // ========== 开始/停止控制 ==========
    function startAutoplay() {
        if (isRunning) return;
        isRunning = true;
        updateStatus('运行中', '#4ade80');
        startBtn.disabled = true;
        stopBtn.disabled = false;
        addLog('🚀 自动播放已启动');

        // 立即执行一次
        checkAndProcess();

        // 设置定时器
        mainInterval = setInterval(checkAndProcess, CONFIG.checkInterval);

        // PPT 单独用更快的节奏（一次点击可能只是走一步动画，需要连点）
        pptInterval = setInterval(() => {
            if (!isRunning || isProcessing) return;
            if (getContentType() !== 'ppt') return;
            handlePPT();
        }, CONFIG.pptTickInterval);
    }

    function stopAutoplay() {
        if (!isRunning) return;
        isRunning = false;
        updateStatus('已停止', '#f87171');
        startBtn.disabled = false;
        stopBtn.disabled = true;
        addLog('⏹ 自动播放已停止');

        if (mainInterval) {
            clearInterval(mainInterval);
            mainInterval = null;
        }
        if (pptInterval) {
            clearInterval(pptInterval);
            pptInterval = null;
        }
    }

    // ========== 工具函数 ==========
    function log(...args) {
        if (CONFIG.debug) {
            console.log(
                '%c[讯飞刷课脚本]',
                'color: #4CAF50; font-weight: bold;',
                ...args
            );
        }
        addLog(args.join(' '));
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    // 获取下一个未完成的资源项
    function getNextUnfinishedItem() {
        const items = getResourceItems();
        let foundActive = false;

        for (const item of items) {
            if (item.classList.contains('is-active')) {
                foundActive = true;
                continue;
            }
            // 找到当前项之后的未完成项
            if (foundActive && !isItemCompleted(item)) {
                return item;
            }
        }

        // 如果当前项之后都完成了，找任何未完成的
        for (const item of items) {
            if (!isItemCompleted(item)) {
                return item;
            }
        }

        return null; // 所有都完成了
    }

    // 获取资源列表摘要（用于日志）
    function getResourceSummary() {
        const items = getResourceItems();
        if (items.length === 0) return '无资源';

        const summary = Array.from(items).map((item, i) => {
            const isActive = item.classList.contains('is-active');
            const completed = isItemCompleted(item);
            const name = item.textContent?.trim().substring(0, 30) || '?';
            let status = completed ? '✅' : '⏳';
            if (isActive) status += '(当前)';
            return `${i + 1}.${name} ${status}`;
        });

        return summary.join(' | ');
    }

    // 查找"继续学习下一节"按钮
    function findNextSectionButton() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text.includes('继续学习下一节') || text.includes('下一节')) {
                return btn;
            }
        }
        const gradientBtns = document.querySelectorAll('.el-button--gradient.btn-right');
        for (const btn of gradientBtns) {
            if (btn.textContent.includes('下一节')) {
                return btn;
            }
        }
        return null;
    }

    // 查找视频元素
    function findVideo() {
        return document.querySelector('video');
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
        return document.querySelector('.pptWrap')
            || document.querySelector('.pptContainer')
            || document.querySelector('#SlidePanel');
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

    // 判断当前内容类型
    function getContentType() {
        if (document.querySelector('video')) return 'video';
        if (findPptRoot()) return 'ppt';
        // 检测自适应练习页面（有"开始练习"按钮）
        if (document.querySelector('button.el-button--gradient.el-button--large span')) {
            const btnTexts = document.querySelectorAll('button.el-button--gradient.el-button--large span');
            for (const span of btnTexts) {
                if (span.textContent.trim() === '开始练习') return 'practice';
            }
        }
        return 'unknown';
    }

    // 查找"开始练习"按钮
    function findStartPracticeButton() {
        const btns = document.querySelectorAll('button.el-button--gradient.el-button--large');
        for (const btn of btns) {
            if (btn.textContent.trim().includes('开始练习')) {
                return btn;
            }
        }
        return null;
    }

    // 检测PPT是否已到最后一页
    function isSlideAtEnd() {
        // 新版播放器有明确页码，直接按页码判断（不会再把"控件隐藏"误判成最后一页）
        const info = getSlideInfo();
        if (info && info.total > 0) return info.current >= info.total;

        // 老版没有页码可读时，沿用原来的判断方式
        const nextBtn = findNextSlideButton();
        if (!nextBtn) return true;
        if (nextBtn.disabled || nextBtn.classList.contains('disabled')) return true;
        const style = window.getComputedStyle(nextBtn);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
        const navPanel = document.querySelector('#SlideshowNavigationPanel');
        if (navPanel) {
            const navStyle = window.getComputedStyle(navPanel);
            if (navStyle.visibility === 'hidden') return true;
        }
        return false;
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

    // PowerPoint Online（owas.fifedu.com 的 iframe）崩溃时会显示"很抱歉,遇到问题"，
    // 这里自动点它的"重新启动"，尽量把播放器救回来。
    // 注意：只检查叶子节点，对大容器取 textContent 会遍历整棵子树，非常耗性能
    function watchPptViewerCrash() {
        if (!CONFIG.autoRestartPptViewer) return;
        let lastRestartAt = 0;
        setInterval(() => {
            if (Date.now() - lastRestartAt < 60000) return;
            const nodes = document.querySelectorAll('button, a, span, div, li');
            for (const el of nodes) {
                if (el.children.length > 0) continue;
                if ((el.textContent || '').trim() !== '重新启动') continue;
                lastRestartAt = Date.now();
                console.warn('[讯飞刷课脚本] 检测到 PPT 播放器崩溃弹窗，自动点击"重新启动"');
                try { el.click(); } catch (e) { /* ignore */ }
                return;
            }
        }, 10000);
    }

    // 关闭弹窗
    function dismissDialogs() {
        const closeBtns = document.querySelectorAll(
            '.el-dialog__headerbtn, .el-message-box__headerbtn, .el-notification__closeBtn'
        );
        closeBtns.forEach(btn => {
            if (btn.offsetParent !== null) btn.click();
        });
    }

    // ========== 视频处理 ==========

    let currentVideoSrc = '';

    async function initVideoPlayer() {
        const video = findVideo();
        if (!video) return false;

        if (video.src === currentVideoSrc && !video.paused) return true;

        const isNewVideo = video.src !== currentVideoSrc;
        currentVideoSrc = video.src;

        // 设置播放参数
        if (CONFIG.autoMute && !video.muted) {
            video.muted = true;
        }
        if (video.playbackRate !== CONFIG.playbackRate) {
            video.playbackRate = CONFIG.playbackRate;
        }

        // 自动播放
        if (video.paused) {
            try {
                const playBtn = findPlayButton();
                if (playBtn) playBtn.click();
                await sleep(500);
                if (video.paused) await video.play();
            } catch (e) {
                video.muted = true;
                try { await video.play(); } catch (e2) { /* ignore */ }
            }
        }

        if (isNewVideo) {
            log(`🎬 新视频已加载, 时长: ${video.duration?.toFixed(0) || '加载中'}s, 速率: ${video.playbackRate}x`);
        }
        return true;
    }

    // ========== PPT处理 ==========

    let pptLastSignal = '';
    let pptLastChangeAt = 0;
    let pptLastClickAt = 0;
    let pptLastClickPageKey = '';
    let pptClickCount = 0;
    let pptKeyTried = false;
    let pptNotified = false;
    let pptRetryAt = 0;
    let pptNoButtonCount = 0;

    // 以"站点保存的进度"为准：新播放器的 .page 数字会和真实状态不同步，不能作为唯一依据
    async function handlePPT() {
        const now = Date.now();
        const activeItem = getActiveResourceItem();
        const progress = activeItem ? getItemProgress(activeItem) : null;
        const slideInfo = getSlideInfo();
        const slideKey = slideInfo ? `${slideInfo.current}/${slideInfo.total}` : '';
        const nextSlideBtn = findNextSlideButton();

        // 页码或进度任一变化，都说明这一轮有推进
        const signal = `${slideKey || '?'}#${progress === null ? '?' : progress}`;
        if (signal !== pptLastSignal) {
            pptLastSignal = signal;
            pptLastChangeAt = now;
            pptKeyTried = false;
        }

        // 1) 站点进度达标 → 完成
        if (progress !== null && progress >= CONFIG.progressRequired) {
            if (!pptNotified) {
                pptNotified = true;
                log(`✅ PPT已完成，站点进度 ${progress}%`);
            }
            return true;
        }

        // 2) 页码已经到最后一页 → 等站点进度更新即可，不再翻页
        if (slideInfo && slideInfo.total > 0 && slideInfo.current >= slideInfo.total) {
            if (!pptNotified) {
                pptNotified = true;
                log(`✅ PPT已翻到最后一页 (${slideKey})，等待进度更新`);
            }
            return false;
        }

        // 3) 翻页按钮已禁用 → 同上
        if (nextSlideBtn && (nextSlideBtn.disabled || nextSlideBtn.classList.contains('disabled'))) {
            if (!pptNotified) {
                pptNotified = true;
                log(`✅ PPT翻页按钮已禁用 (${slideKey || '未知'})，等待进度更新`);
            }
            return false;
        }

        // 4) 老版播放器（#SlidePanel）：读不到页码且按钮消失 → 视为结束
        //    新版播放器有 .pptWrap，不走这个规则，避免按钮加载间隙被误判为结束
        const newViewer = !!document.querySelector('.pptWrap, .pptContainer');
        if (!newViewer && !slideInfo && !nextSlideBtn) {
            pptNoButtonCount++;
            if (pptNoButtonCount >= 3) {
                log('✅ PPT已翻到最后一页（翻页按钮已消失）');
                return true;
            }
            return false;
        }
        pptNoButtonCount = 0;

        // 5) 长时间没有推进
        const stuckFor = now - pptLastChangeAt;
        if (stuckFor > CONFIG.slideStuckTimeout) {
            if (!pptKeyTried) {
                pptKeyTried = true;
                log(`⚠️ PPT ${Math.round(stuckFor / 1000)}秒没有变化（当前 ${slideKey || '未知'}，进度 ${progress === null ? '未知' : progress + '%'}），改用方向键尝试`);
                pressSlideNextKey();
                return false;
            }
            if (now < pptRetryAt) return false;
            pptRetryAt = now + CONFIG.slideRetryInterval;
            log(`🔁 PPT仍未推进（当前 ${slideKey || '未知'}），${Math.round(CONFIG.slideRetryInterval / 1000)}秒后重试`);
            pressSlideNextKey();
            return false;
        }

        // 6) 按间隔翻页
        //    - 页码和上次点击时一样：说明这一下只是走了同页动画，隔得短一点继续点
        //    - 页码变了：说明真翻页了，多等一会儿让画面渲染完
        const pageAdvancedSinceClick = !!slideKey && slideKey !== pptLastClickPageKey;

        // 保险丝：单个PPT点击次数异常多时彻底停下，避免把浏览器拖死
        if (pptClickCount >= CONFIG.maxSlideClicks) {
            if (!pptNotified) {
                pptNotified = true;
                log(`⛔ PPT点击次数已达上限（${pptClickCount} 次），停止翻页，请手动检查`);
            }
            return false;
        }

        const clickDelay = pageAdvancedSinceClick
            ? CONFIG.slideIntervalPage
            : CONFIG.slideIntervalAnim;
        if (now - pptLastClickAt < clickDelay) return false;
        pptLastClickAt = now;
        pptLastClickPageKey = slideKey;
        pptClickCount++;
        if (pageAdvancedSinceClick) {
            log(`📄 [PPT] 翻页, 当前: ${slideKey || '未知'}，进度 ${progress === null ? '未知' : progress + '%'}`);
        } else if (pptClickCount % 5 === 1) {
            log(`▸ [PPT] 点击推进同页动画, 当前: ${slideKey || '未知'}`);
        }
        if (nextSlideBtn) clickElement(nextSlideBtn);
        else pressSlideNextKey();
        return false;
    }

    function resetPPTState() {
        pptLastSignal = '';
        pptLastChangeAt = 0;
        pptLastClickAt = 0;
        pptLastClickPageKey = '';
        pptClickCount = 0;
        pptKeyTried = false;
        pptNotified = false;
        pptRetryAt = 0;
        pptNoButtonCount = 0;
    }

    // ========== 主控制逻辑 ==========

    let isProcessing = false;
    let lastProgressTime = 0;

    // 更新进度显示
    function updateProgressDisplay() {
        const items = getResourceItems();
        if (items.length === 0) {
            updateProgress('无资源', 0);
            return;
        }

        const completedCount = Array.from(items).filter(item => isItemCompleted(item)).length;
        const percent = (completedCount / items.length) * 100;
        const activeItem = getActiveResourceItem();
        const contentType = getContentType();

        let statusInfo = '';
        if (contentType === 'video') {
            const video = findVideo();
            if (video && video.duration) {
                const videoPct = ((video.currentTime / video.duration) * 100).toFixed(1);
                const remaining = (video.duration - video.currentTime).toFixed(0);
                statusInfo = ` | 视频: ${videoPct}% (${remaining}s)`;
            }
        } else if (contentType === 'ppt') {
            const slideInfo = getSlideInfo();
            if (slideInfo) {
                statusInfo = ` | PPT: ${slideInfo.current}/${slideInfo.total}`;
            }
        } else if (contentType === 'practice') {
            statusInfo = ' | 练习中';
        }

        updateProgress(`已完成 ${completedCount}/${items.length}${statusInfo}`, percent);
    }

    async function checkAndProcess() {
        if (isProcessing) return;

        // 更新进度显示
        updateProgressDisplay();

        dismissDialogs();

        // 检查当前活跃资源项是否已完成
        const activeItem = getActiveResourceItem();
        if (activeItem && isItemCompleted(activeItem)) {
            // 当前内容已完成，尝试切换到下一个
            isProcessing = true;
            log('当前内容已完成，查找下一个未完成的内容...');
            log(`资源状态: ${getResourceSummary()}`);

            const nextItem = getNextUnfinishedItem();
            if (nextItem) {
                const name = nextItem.textContent?.trim().substring(0, 40) || '未知';
                log(`👉 切换到下一个内容: ${name}`);
                resetPPTState();
                currentVideoSrc = '';
                nextItem.click();
                await sleep(CONFIG.switchWait);
                // 新内容加载后初始化
                await initVideoPlayer();
            } else {
                // 本节所有内容都完成了，尝试跳到下一节
                log('🎉 本节所有内容已完成!');
                log(`资源状态: ${getResourceSummary()}`);
                updateStatus('已完成', '#4ade80');

                const nextSectionBtn = findNextSectionButton();
                if (nextSectionBtn) {
                    log('✅ 点击"继续学习下一节"');
                    resetPPTState();
                    currentVideoSrc = '';
                    nextSectionBtn.click();
                    await sleep(CONFIG.switchWait);
                    await initVideoPlayer();
                } else {
                    log('⚠️ 未找到"下一节"按钮，所有任务可能已完成');
                    updateProgress('所有任务已完成!', 100);
                    stopAutoplay();
                }
            }
            isProcessing = false;
            return;
        }

        // 当前内容未完成，根据类型处理
        const contentType = getContentType();

        if (contentType === 'video') {
            await initVideoPlayer();
            const video = findVideo();
            if (video) {
                // 检查是否卡住
                if (video.paused && video.readyState >= 3 && !video.ended) {
                    const now = Date.now();
                    if (now - lastProgressTime > 15000) {
                        log('视频暂停中，尝试恢复播放...');
                        lastProgressTime = now;
                    }
                    try {
                        const playBtn = findPlayButton();
                        if (playBtn) playBtn.click();
                        else await video.play();
                    } catch (e) { /* ignore */ }
                }

                // 更新视频进度
                const now = Date.now();
                if (!video.paused && video.duration) {
                    const pct = ((video.currentTime / video.duration) * 100).toFixed(1);
                    const remaining = (video.duration - video.currentTime).toFixed(0);
                    updateProgress(`视频播放中: ${pct}% | 剩余 ${remaining}s`, (video.currentTime / video.duration) * 100);
                    
                    // 定期输出日志
                    if (now - lastProgressTime > 30000) {
                        log(`📊 [视频] ${pct}% | 剩余 ${remaining}s`);
                        lastProgressTime = now;
                    }
                }
            }
        } else if (contentType === 'ppt') {
            await handlePPT();
        } else if (contentType === 'practice') {
            isProcessing = true;
            log('📝 检测到自适应练习，点击"开始练习"...');
            const startBtn = findStartPracticeButton();
            if (startBtn) {
                startBtn.click();
                log('✅ 已点击"开始练习"按钮，等待完成...');
                await sleep(5000);
            }
            isProcessing = false;
        }
    }

    // ========== 启动 ==========

    async function start() {
        // 创建悬浮窗
        createControlPanel();
        
        log('========================================');
        log('  讯飞智课自动刷课脚本 v2.4 已加载');
        log(`  播放速率: ${CONFIG.playbackRate}x`);
        log(`  自动静音: ${CONFIG.autoMute ? '是' : '否'}`);
        log('========================================');

        await sleep(1000);

        // PowerPoint Online 崩溃自救（播放器在 iframe 里，主页面也要帮忙盯着）
        watchPptViewerCrash();

        // 显示当前资源状态
        log(`📋 当前资源: ${getResourceSummary()}`);
        updateProgressDisplay();

        // 监听视频ended事件
        document.addEventListener('ended', async (e) => {
            if (e.target.tagName === 'VIDEO' && isRunning) {
                log('视频播放结束事件触发');
                await sleep(1000);
                await checkAndProcess();
            }
        });

        // 监听页面变化（SPA动态加载）
        let observerLastRun = 0;
        const observer = new MutationObserver(async () => {
            if (!isRunning) return;
            // 页面变动很频繁，节流一下，别让回调跟着一直跑
            if (Date.now() - observerLastRun < 1000) return;
            observerLastRun = Date.now();
            const video = findVideo();
            if (video && video.src !== currentVideoSrc) {
                log('检测到视频源变化，重新初始化');
                currentVideoSrc = '';
                await sleep(2000);
                await initVideoPlayer();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        log('脚本加载完成，点击"开始"按钮启动自动播放');
    }

    if (window.top === window.self) {
        // 顶层页面负责全部刷课逻辑
        start();
    } else {
        // 子 iframe 里只保留 PPT 崩溃自救，不再各跑一份逻辑（多份实例同时点会把浏览器拖死）
        watchPptViewerCrash();
    }
})();
