/**
 * 색상 템플릿 정의
 * 16개의 창의적인 색상 테마
 */
import type { ColorSettings } from './useStyleSettings'

export interface ColorTemplate {
  id: string
  name: string
  description: string
  colors: ColorSettings
}

export const COLOR_TEMPLATES: ColorTemplate[] = [
  // ========== 기본 테마 ==========
  {
    id: 'milkyway',
    name: '🌌 Milkyway',
    description: '부드러운 파스텔 보라-핑크 그라데이션',
    colors: {
      gradientStart: '#e8d5f2',
      gradientMid: '#f0d4e8',
      gradientEnd: '#fce4ec',
      colorPrimary: '#9c7cb5',
      colorPrimaryHover: '#8b6aa3',
      colorPrimaryLight: '#d4c4e0',
      colorSecondary: '#d4a5c9',
      colorAccent: '#b8a5d4',
      bgPrimary: '#faf8fc',
      bgSecondary: '#f5f0f8',
      textPrimary: '#4a3f5c',
      textSecondary: '#7a6b8a',
      textMuted: '#b8adc4'
    }
  },
  {
    id: 'galaxy',
    name: '🌙 Galaxy',
    description: '어두운 파스텔톤의 나이트 모드',
    colors: {
      gradientStart: '#2d2640',
      gradientMid: '#3d3154',
      gradientEnd: '#4a3d5c',
      colorPrimary: '#9d8ec2',
      colorPrimaryHover: '#8a7bb0',
      colorPrimaryLight: '#5c4f73',
      colorSecondary: '#b794c9',
      colorAccent: '#7eb8c9',
      bgPrimary: '#1e1a26',
      bgSecondary: '#2a2533',
      textPrimary: '#e8e4f0',
      textSecondary: '#b8b0c8',
      textMuted: '#7a7290'
    }
  },

  // ========== 자연 테마 ==========
  {
    id: 'sakura',
    name: '🌸 Sakura',
    description: '벚꽃이 흩날리는 봄날',
    colors: {
      gradientStart: '#ffeef2',
      gradientMid: '#ffd9e4',
      gradientEnd: '#fff5f7',
      colorPrimary: '#e91e63',
      colorPrimaryHover: '#c2185b',
      colorPrimaryLight: '#f8bbd9',
      colorSecondary: '#f06292',
      colorAccent: '#ff80ab',
      bgPrimary: '#fffbfc',
      bgSecondary: '#fff0f4',
      textPrimary: '#4a2c36',
      textSecondary: '#7a5a66',
      textMuted: '#c4a0ac'
    }
  },
  {
    id: 'mint',
    name: '🌿 Mint Fresh',
    description: '상쾌한 민트 그린 테마',
    colors: {
      gradientStart: '#d5f2e8',
      gradientMid: '#c4e8dc',
      gradientEnd: '#e0f5f0',
      colorPrimary: '#4db6ac',
      colorPrimaryHover: '#3d9e94',
      colorPrimaryLight: '#b2dfdb',
      colorSecondary: '#80cbc4',
      colorAccent: '#a5d6d0',
      bgPrimary: '#f8fcfb',
      bgSecondary: '#f0f8f6',
      textPrimary: '#2e4a45',
      textSecondary: '#5a7a74',
      textMuted: '#a0c4bc'
    }
  },
  {
    id: 'ocean',
    name: '🌊 Ocean Blue',
    description: '깊고 고요한 바다의 블루',
    colors: {
      gradientStart: '#d5e8f2',
      gradientMid: '#c4dce8',
      gradientEnd: '#e0f0f5',
      colorPrimary: '#1976d2',
      colorPrimaryHover: '#1565c0',
      colorPrimaryLight: '#bbdefb',
      colorSecondary: '#42a5f5',
      colorAccent: '#64b5f6',
      bgPrimary: '#f8fbfc',
      bgSecondary: '#f0f6f8',
      textPrimary: '#1a3a52',
      textSecondary: '#4a6a82',
      textMuted: '#90b0c4'
    }
  },
  {
    id: 'forest',
    name: '🌲 Forest',
    description: '깊은 숲속의 자연 그린',
    colors: {
      gradientStart: '#e8f5e9',
      gradientMid: '#c8e6c9',
      gradientEnd: '#dcedc8',
      colorPrimary: '#388e3c',
      colorPrimaryHover: '#2e7d32',
      colorPrimaryLight: '#a5d6a7',
      colorSecondary: '#66bb6a',
      colorAccent: '#81c784',
      bgPrimary: '#f9fcf9',
      bgSecondary: '#f1f8f1',
      textPrimary: '#1b3d1e',
      textSecondary: '#4a6b4d',
      textMuted: '#9cb89e'
    }
  },
  {
    id: 'sunset',
    name: '🌅 Sunset',
    description: '노을지는 저녁 하늘',
    colors: {
      gradientStart: '#ffecd2',
      gradientMid: '#fcb69f',
      gradientEnd: '#ffe5d9',
      colorPrimary: '#ff7043',
      colorPrimaryHover: '#f4511e',
      colorPrimaryLight: '#ffccbc',
      colorSecondary: '#ff8a65',
      colorAccent: '#ffab91',
      bgPrimary: '#fffcfa',
      bgSecondary: '#fff5f0',
      textPrimary: '#4a2c1a',
      textSecondary: '#7a5a48',
      textMuted: '#c4a090'
    }
  },
  {
    id: 'aurora',
    name: '🌌 Aurora',
    description: '오로라의 신비로운 빛',
    colors: {
      gradientStart: '#d5f5e3',
      gradientMid: '#a8e6cf',
      gradientEnd: '#88d8b0',
      colorPrimary: '#00bfa5',
      colorPrimaryHover: '#00a896',
      colorPrimaryLight: '#a7ffeb',
      colorSecondary: '#64ffda',
      colorAccent: '#1de9b6',
      bgPrimary: '#f5fdfb',
      bgSecondary: '#e8faf5',
      textPrimary: '#004d40',
      textSecondary: '#00796b',
      textMuted: '#80cbc4'
    }
  },

  // ========== 음식/음료 테마 ==========
  {
    id: 'redwine',
    name: '🍷 Red Wine',
    description: '우아한 와인 레드 톤',
    colors: {
      gradientStart: '#f2d5d8',
      gradientMid: '#e8c4c9',
      gradientEnd: '#f5e0e3',
      colorPrimary: '#a64d5e',
      colorPrimaryHover: '#8f3d4d',
      colorPrimaryLight: '#e0c4c9',
      colorSecondary: '#c98a94',
      colorAccent: '#d4a5a5',
      bgPrimary: '#fcf8f8',
      bgSecondary: '#f8f0f1',
      textPrimary: '#5c3a40',
      textSecondary: '#8a6a70',
      textMuted: '#c4adb0'
    }
  },
  {
    id: 'popsicle',
    name: '🍭 Popsicle',
    description: '톡톡 튀는 비비드 컬러',
    colors: {
      gradientStart: '#ffd6e8',
      gradientMid: '#c8f0ff',
      gradientEnd: '#fff0c8',
      colorPrimary: '#ff6b9d',
      colorPrimaryHover: '#e85a8a',
      colorPrimaryLight: '#ffb8d0',
      colorSecondary: '#4ecdc4',
      colorAccent: '#ffe66d',
      bgPrimary: '#fffbfc',
      bgSecondary: '#fff5f8',
      textPrimary: '#4a3545',
      textSecondary: '#7a6575',
      textMuted: '#b8a8b4'
    }
  },
  {
    id: 'applejack',
    name: '🍎 Applejack',
    description: '사과 과수원의 따뜻한 오렌지 톤',
    colors: {
      gradientStart: '#ffe8d5',
      gradientMid: '#ffd4b8',
      gradientEnd: '#fff0e0',
      colorPrimary: '#e07830',
      colorPrimaryHover: '#c86820',
      colorPrimaryLight: '#f5d4b8',
      colorSecondary: '#7cb342',
      colorAccent: '#d32f2f',
      bgPrimary: '#fffcf8',
      bgSecondary: '#fff8f0',
      textPrimary: '#5c4030',
      textSecondary: '#8a7060',
      textMuted: '#c4b0a0'
    }
  },
  {
    id: 'matcha',
    name: '🍵 Matcha',
    description: '부드러운 말차 그린',
    colors: {
      gradientStart: '#e8f5e1',
      gradientMid: '#d4e8c4',
      gradientEnd: '#f0f5e8',
      colorPrimary: '#7cb342',
      colorPrimaryHover: '#689f38',
      colorPrimaryLight: '#c5e1a5',
      colorSecondary: '#9ccc65',
      colorAccent: '#aed581',
      bgPrimary: '#fcfdf8',
      bgSecondary: '#f5f8f0',
      textPrimary: '#33472e',
      textSecondary: '#5a7052',
      textMuted: '#a8c49c'
    }
  },
  {
    id: 'lavender',
    name: '💜 Lavender',
    description: '향기로운 라벤더 필드',
    colors: {
      gradientStart: '#e8e0f0',
      gradientMid: '#d5c8e8',
      gradientEnd: '#f0e8f5',
      colorPrimary: '#7e57c2',
      colorPrimaryHover: '#6a4aab',
      colorPrimaryLight: '#b39ddb',
      colorSecondary: '#9575cd',
      colorAccent: '#b388ff',
      bgPrimary: '#faf8fc',
      bgSecondary: '#f3f0f8',
      textPrimary: '#3d2e52',
      textSecondary: '#6a5a7a',
      textMuted: '#a898b8'
    }
  },

  // ========== 특별 테마 ==========
  {
    id: 'cyberpunk',
    name: '🔮 Cyberpunk',
    description: '네온 사이버펑크 나이트',
    colors: {
      gradientStart: '#1a1a2e',
      gradientMid: '#16213e',
      gradientEnd: '#0f0f23',
      colorPrimary: '#e94560',
      colorPrimaryHover: '#d63d55',
      colorPrimaryLight: '#ff6b8a',
      colorSecondary: '#00fff5',
      colorAccent: '#ff00ff',
      bgPrimary: '#0d0d1a',
      bgSecondary: '#15152a',
      textPrimary: '#ffffff',
      textSecondary: '#b8c5d6',
      textMuted: '#5a6a7a'
    }
  },
  {
    id: 'rosegold',
    name: '✨ Rose Gold',
    description: '럭셔리 로즈골드 메탈릭',
    colors: {
      gradientStart: '#fdf2f0',
      gradientMid: '#f8e0db',
      gradientEnd: '#fef6f4',
      colorPrimary: '#b76e79',
      colorPrimaryHover: '#a35d68',
      colorPrimaryLight: '#ddb8be',
      colorSecondary: '#c9a0a5',
      colorAccent: '#d4af37',
      bgPrimary: '#fffaf9',
      bgSecondary: '#fef4f2',
      textPrimary: '#4a3538',
      textSecondary: '#7a6062',
      textMuted: '#baa0a4'
    }
  },
  {
    id: 'midnight',
    name: '🌃 Midnight',
    description: '고요한 한밤의 도시',
    colors: {
      gradientStart: '#1e2130',
      gradientMid: '#252a3a',
      gradientEnd: '#2c3144',
      colorPrimary: '#5c7cfa',
      colorPrimaryHover: '#4c6ef5',
      colorPrimaryLight: '#3d4a6b',
      colorSecondary: '#748ffc',
      colorAccent: '#91a7ff',
      bgPrimary: '#161922',
      bgSecondary: '#1e222e',
      textPrimary: '#e8eaf0',
      textSecondary: '#a8b0c0',
      textMuted: '#606878'
    }
  }
]

// 기본 색상 (Milkyway)
export const DEFAULT_COLORS: ColorSettings = COLOR_TEMPLATES[0]!.colors
