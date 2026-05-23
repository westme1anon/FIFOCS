// ==UserScript==
// @name         讯飞智课自动刷课脚本
// @namespace    http://tampermonkey.net/
// @version      2.0
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

    // ========== 工具函数 ==========
    function log(...args) {
        if (CONFIG.debug) {
            console.log(
                '%c[讯飞刷课脚本]',
                'color: #4CAF50; font-weight: bold;',
                ...args
            );
        }
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

    async function checkAndProcess() {
        if (isProcessing) return;

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

                // 定期输出进度
                const now = Date.now();
                if (!video.paused && video.duration && now - lastProgressTime > 30000) {
                    const pct = ((video.currentTime / video.duration) * 100).toFixed(1);
                    const remaining = (video.duration - video.currentTime).toFixed(0);
                    log(`📊 [视频] ${pct}% | 剩余 ${remaining}s`);
                    lastProgressTime = now;
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
        log('========================================');
        log('  讯飞智课自动刷课脚本 v2.0 已启动');
        log(`  播放速率: ${CONFIG.playbackRate}x`);
        log(`  自动静音: ${CONFIG.autoMute ? '是' : '否'}`);
        log('========================================');

        await sleep(3000);

        // 显示当前资源状态
        log(`📋 当前资源: ${getResourceSummary()}`);

        // 初始化视频
        await initVideoPlayer();

        // 定时检查
        setInterval(checkAndProcess, CONFIG.checkInterval);

        // 监听视频ended事件
        document.addEventListener('ended', async (e) => {
            if (e.target.tagName === 'VIDEO') {
                log('视频播放结束事件触发');
                await sleep(1000);
                await checkAndProcess();
            }
        });

        // 监听页面变化（SPA动态加载）
        const observer = new MutationObserver(async () => {
            const video = findVideo();
            if (video && video.src !== currentVideoSrc) {
                log('检测到视频源变化，重新初始化');
                currentVideoSrc = '';
                await sleep(2000);
                await initVideoPlayer();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        log('脚本初始化完成，开始监控...');
    }

    start();
})();