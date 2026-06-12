// ==UserScript==
// @name         讯飞智课自动刷课脚本
// @namespace    http://tampermonkey.net/
// @version      2.1
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
        checkInterval: 3000,
        // PPT翻页间隔（毫秒）
        slideInterval: 2000,
        // 内容切换等待时间（毫秒）
        switchWait: 3000,
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

    // ========== 悬浮窗UI ==========
    function createControlPanel() {
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
        const text = item.textContent || '';
        return text.includes('已完成');
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

    // 查找PPT下一页按钮
    function findNextSlideButton() {
        return document.querySelector('#buttonNextSlide');
    }

    // 判断当前内容类型
    function getContentType() {
        if (document.querySelector('video')) return 'video';
        if (document.querySelector('#SlidePanel')) return 'ppt';
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
        const slidePanel = document.querySelector('#SlidePanel');
        if (!slidePanel) return null;
        const pageIndicators = slidePanel.querySelectorAll(
            '[class*="page"], [class*="slide"], [id*="page"]'
        );
        for (const el of pageIndicators) {
            const text = el.textContent.trim();
            const match = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (match) {
                return { current: parseInt(match[1]), total: parseInt(match[2]) };
            }
        }
        return null;
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

    let lastSlideHash = '';
    let slideNoChangeCount = 0;

    async function handlePPT() {
        const nextSlideBtn = findNextSlideButton();
        if (!nextSlideBtn) return true;

        if (isSlideAtEnd()) {
            log('✅ PPT已翻到最后一页!');
            return true;
        }

        // 检测页面是否在变化
        const svgElements = document.querySelectorAll('#SlidePanel svg[id$="_svg"]');
        const currentHash = Array.from(svgElements).map(el => el.id).join(',');

        if (currentHash === lastSlideHash) {
            slideNoChangeCount++;
            if (slideNoChangeCount > 5) {
                log('PPT: 页面长时间无变化，判定为已完成');
                return true;
            }
        } else {
            slideNoChangeCount = 0;
            lastSlideHash = currentHash;
        }

        const slideInfo = getSlideInfo();
        const slideText = slideInfo ? `${slideInfo.current}/${slideInfo.total}` : '未知';
        log(`📄 [PPT] 翻页, 当前: ${slideText}`);
        nextSlideBtn.click();

        return false;
    }

    function resetPPTState() {
        lastSlideHash = '';
        slideNoChangeCount = 0;
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
        log('  讯飞智课自动刷课脚本 v2.1 已加载');
        log(`  播放速率: ${CONFIG.playbackRate}x`);
        log(`  自动静音: ${CONFIG.autoMute ? '是' : '否'}`);
        log('========================================');

        await sleep(1000);

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
        const observer = new MutationObserver(async () => {
            if (!isRunning) return;
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

    start();
})();