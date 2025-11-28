<script setup lang="ts">
import { onMounted } from 'vue'
import { useStyleSettings } from './composables/useStyleSettings'

// 스타일 설정 로드 (CSS 변수 적용은 composable 내부에서 처리)
const { initialize } = useStyleSettings()

onMounted(async () => {
  await initialize()
})
</script>

<template>
  <Suspense>
    <router-view />
    <template #fallback>
      <div class="loading">Loading...</div>
    </template>
  </Suspense>
</template>

<style>
/* ============================================
   ChitChat Global CSS Variables
   파스텔 보라~핑크 테마
   ============================================ */
:root {
  /* ===== Primary Gradient Colors ===== */
  --gradient-start: #e8d5f2;        /* 파스텔 라벤더 */
  --gradient-mid: #f0d4e8;          /* 파스텔 핑크 라벤더 */
  --gradient-end: #fce4ec;          /* 파스텔 핑크 */

  /* ===== Main Gradients ===== */
  --gradient-primary: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-mid) 50%, var(--gradient-end) 100%);
  --gradient-primary-reverse: linear-gradient(315deg, var(--gradient-start) 0%, var(--gradient-mid) 50%, var(--gradient-end) 100%);
  --gradient-vertical: linear-gradient(180deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
  --gradient-horizontal: linear-gradient(90deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
  --gradient-accent: linear-gradient(135deg, var(--color-accent) 0%, var(--color-secondary) 100%);

  /* ===== Background with Glass Effect ===== */
  --bg-glass: rgba(255, 255, 255, 0.85);

  /* ===== Accent Colors ===== */
  --color-primary: #9c7cb5;          /* 메인 보라 */
  --color-primary-hover: #8b6aa3;    /* 보라 호버 */
  --color-primary-active: #7a5991;   /* 보라 액티브 */
  --color-primary-light: #d4c4e0;    /* 연한 보라 */

  --color-secondary: #d4a5c9;        /* 핑크 보라 */
  --color-secondary-hover: #c794b8;  /* 핑크 보라 호버 */
  --color-secondary-light: #f5e6f0; /* 연한 핑크 */

  --color-accent: #b8a5d4;           /* 악센트 라벤더 */
  --color-accent-light: #e8e0f0;     /* 연한 악센트 */

  /* ===== Background Colors ===== */
  --bg-primary: #faf8fc;             /* 메인 배경 (아주 연한 라벤더) */
  --bg-secondary: #f5f0f8;           /* 보조 배경 */
  --bg-tertiary: #efe8f4;            /* 3차 배경 */
  --bg-card: rgba(255, 255, 255, 0.85); /* 카드 배경 */
  --bg-card-solid: #ffffff;          /* 카드 솔리드 배경 */
  --bg-input: rgba(255, 255, 255, 0.9); /* 입력창 배경 */
  --bg-overlay: rgba(0, 0, 0, 0.4);  /* 오버레이 배경 */
  --bg-modal: rgba(255, 255, 255, 0.98); /* 모달 배경 */

  /* ===== Text Colors ===== */
  --text-primary: #4a3f5c;           /* 주요 텍스트 (진한 보라 회색) */
  --text-secondary: #7a6b8a;         /* 보조 텍스트 */
  --text-tertiary: #9d8faa;          /* 3차 텍스트 */
  --text-muted: #b8adc4;             /* 흐린 텍스트 */
  --text-on-primary: #ffffff;        /* 프라이머리 위 텍스트 */
  --text-on-gradient: #5c4a6e;       /* 그라데이션 위 텍스트 */
  --text-link: #9c7cb5;              /* 링크 텍스트 */
  --text-link-hover: #7a5991;        /* 링크 호버 */

  /* ===== Border Colors ===== */
  --border-light: rgba(156, 124, 181, 0.15);   /* 연한 테두리 */
  --border-default: rgba(156, 124, 181, 0.25); /* 기본 테두리 */
  --border-strong: rgba(156, 124, 181, 0.4);   /* 진한 테두리 */
  --border-focus: var(--color-primary);         /* 포커스 테두리 */

  /* ===== Button Colors ===== */
  --btn-primary-bg: var(--gradient-primary);
  --btn-primary-text: var(--text-on-gradient);
  --btn-primary-border: var(--border-default);

  --btn-secondary-bg: var(--bg-card);
  --btn-secondary-text: var(--text-primary);
  --btn-secondary-border: var(--border-default);

  --btn-danger-bg: linear-gradient(135deg, #f5d5d5 0%, #f8e0e0 100%);
  --btn-danger-text: #c45a5a;
  --btn-danger-border: rgba(196, 90, 90, 0.3);

  --btn-success-bg: linear-gradient(135deg, #d5f5e3 0%, #e0f8e8 100%);
  --btn-success-text: #5a9c7a;
  --btn-success-border: rgba(90, 156, 122, 0.3);

  /* ===== Shadow ===== */
  --shadow-sm: 0 2px 8px rgba(156, 124, 181, 0.1);
  --shadow-md: 0 4px 16px rgba(156, 124, 181, 0.15);
  --shadow-lg: 0 8px 32px rgba(156, 124, 181, 0.2);
  --shadow-xl: 0 12px 48px rgba(156, 124, 181, 0.25);
  --shadow-glow: 0 0 20px rgba(156, 124, 181, 0.3);

  /* ===== Notification Specific ===== */
  --notification-bg: linear-gradient(135deg, rgba(232, 213, 242, 0.95) 0%, rgba(252, 228, 236, 0.95) 100%);
  --notification-border: rgba(156, 124, 181, 0.3);
  --notification-text: var(--text-primary);
  --notification-text-secondary: var(--text-secondary);

  /* ===== Status Colors ===== */
  --color-success: #7cb58f;
  --color-success-bg: #e8f5ec;
  --color-success-rgb: 124, 181, 143;
  --color-warning: #d4a85c;
  --color-warning-bg: #faf3e8;
  --color-warning-text: #856404;
  --color-error: #c47a7a;
  --color-error-bg: #f8eeee;
  --color-error-rgb: 196, 122, 122;
  --color-info: #7a9cc4;
  --color-info-bg: #eef4f8;

  /* ===== RGB values for rgba() usage ===== */
  --color-primary-rgb: 156, 124, 181;

  /* ===== Typography ===== */
  --font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
  --font-family-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;

  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-base: 14px;
  --font-size-md: 15px;
  --font-size-lg: 17px;
  --font-size-xl: 20px;
  --font-size-2xl: 24px;
  --font-size-3xl: 28px;

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --line-height-tight: 1.2;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.7;

  --letter-spacing-tight: -0.02em;
  --letter-spacing-normal: 0;
  --letter-spacing-wide: 0.02em;

  /* ===== Spacing ===== */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;
  --spacing-2xl: 32px;
  --spacing-3xl: 48px;

  /* ===== Border Radius ===== */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* ===== Transitions ===== */
  --transition-fast: 0.15s ease;
  --transition-normal: 0.25s ease;
  --transition-slow: 0.4s ease;

  /* ===== Z-Index ===== */
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal: 1000;
  --z-notification: 1100;
  --z-tooltip: 1200;

  /* ===== Custom Background Image ===== */
  --bg-custom-image: none;
  --bg-custom-overlay: rgba(255, 255, 255, 0.75);

  /* ===== Style Settings (adjustable via Settings page) ===== */
  --container-opacity: 0.85;
  --container-opacity-home: 0.85;
  --container-opacity-chat: 0.85;
  --bg-overlay-opacity: 0.75;
  --bg-overlay-opacity-home: 0.75;
  --bg-overlay-opacity-chat: 0.75;
  --bg-overlay-opacity-notification: 0.6;
}

/* ============================================
   Global Reset & Base Styles
   ============================================ */
html,
body,
#app {
  height: 100%;
}

html,
body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  background: var(--bg-primary);
  line-height: var(--line-height-normal);
  letter-spacing: var(--letter-spacing-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

/* ===== Scrollbar Styling ===== */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb {
  background: var(--color-primary-light);
  border-radius: var(--radius-full);
  transition: background var(--transition-fast);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-primary);
}

/* ===== Selection Styling ===== */
::selection {
  background: var(--color-primary-light);
  color: var(--text-primary);
}

/* ===== Focus Styling ===== */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* ===== Link Styling ===== */
a {
  color: var(--text-link);
  text-decoration: none;
  transition: color var(--transition-fast);
}

a:hover {
  color: var(--text-link-hover);
}

/* ===== Loading Screen ===== */
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-size: var(--font-size-lg);
  color: var(--text-secondary);
  background: var(--gradient-primary);
}

/* ============================================
   Utility Classes
   ============================================ */
.gradient-bg {
  background: var(--gradient-primary);
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(10px);
}

.btn-primary {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border: 1px solid var(--btn-primary-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm) var(--spacing-lg);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-primary:hover:not(:disabled) {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(0);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--btn-secondary-bg);
  color: var(--btn-secondary-text);
  border: 1px solid var(--btn-secondary-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm) var(--spacing-lg);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-tertiary);
  box-shadow: var(--shadow-sm);
}
</style>
