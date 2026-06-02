import { createContext, useContext } from 'react'

export type ThemeMode = 'light' | 'dark'

export interface ThemeTokens {
  mode: ThemeMode
  bg: string
  sidebar: string
  titleBar: string
  surface: string
  border: string
  text: string
  textSecondary: string
  accent: string
  hover: string
  activeBg: string
  controlBtnColor: string
  controlBtnHoverBg: string
  closeHoverBg: string
  logoOpacity: number
  // Dashboard-specific
  dashGradient: string
  dashBtnStartBg: string
  dashBtnStopBg: string
  dashBtnText: string
  dashStatusColor: string
  dashSlotBg: string
  dashSlotActiveBg: string
  dashSlotBorder: string
  dashSlotActiveBorder: string
  dashSlotText: string
  dashSlotTextDim: string
  dashActionBtnBg: string
  dashActionBtnBorder: string
  dashActionBtnColor: string
  dashStopBtnBg: string
  dashStopBtnBorder: string
  dashStopBtnColor: string
}

const darkTokens: ThemeTokens = {
  mode: 'dark',
  bg: '#0d1124',
  sidebar: '#0b0f1e',
  titleBar: '#070a16',
  surface: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.06)',
  text: 'rgba(255,255,255,0.85)',
  textSecondary: 'rgba(255,255,255,0.35)',
  accent: '#4b6cf7',
  hover: 'rgba(255,255,255,0.06)',
  activeBg: 'rgba(75, 108, 247, 0.15)',
  controlBtnColor: 'rgba(255,255,255,0.5)',
  controlBtnHoverBg: 'rgba(255,255,255,0.06)',
  closeHoverBg: '#e81123',
  logoOpacity: 0.9,
  dashGradient: 'linear-gradient(180deg, #0d1124 0%, #141b33 30%, #1a2447 60%, #0f1935 100%)',
  dashBtnStartBg: 'linear-gradient(145deg, #4b6cf7, #3b5de7)',
  dashBtnStopBg: 'linear-gradient(145deg, #1e2a4a, #152040)',
  dashBtnText: '#fff',
  dashStatusColor: '#fff',
  dashSlotBg: 'rgba(255,255,255,0.03)',
  dashSlotActiveBg: 'rgba(75, 108, 247, 0.2)',
  dashSlotBorder: 'rgba(255,255,255,0.05)',
  dashSlotActiveBorder: 'rgba(75, 108, 247, 0.45)',
  dashSlotText: 'rgba(255,255,255,0.6)',
  dashSlotTextDim: 'rgba(255,255,255,0.5)',
  dashActionBtnBg: 'rgba(255,255,255,0.08)',
  dashActionBtnBorder: 'rgba(255,255,255,0.1)',
  dashActionBtnColor: 'rgba(255,255,255,0.8)',
  dashStopBtnBg: 'rgba(255,77,79,0.1)',
  dashStopBtnBorder: 'rgba(255,77,79,0.2)',
  dashStopBtnColor: '#ff6b6b'
}

const lightTokens: ThemeTokens = {
  mode: 'light',
  bg: '#f0f2f5',
  sidebar: '#fff',
  titleBar: '#fafafa',
  surface: 'rgba(0,0,0,0.02)',
  border: 'rgba(0,0,0,0.06)',
  text: 'rgba(0,0,0,0.85)',
  textSecondary: 'rgba(0,0,0,0.45)',
  accent: '#4b6cf7',
  hover: 'rgba(0,0,0,0.04)',
  activeBg: 'rgba(75, 108, 247, 0.1)',
  controlBtnColor: 'rgba(0,0,0,0.5)',
  controlBtnHoverBg: 'rgba(0,0,0,0.06)',
  closeHoverBg: '#e81123',
  logoOpacity: 1,
  dashGradient: 'linear-gradient(180deg, #e8ecf1 0%, #f0f2f5 50%, #e8ecf1 100%)',
  dashBtnStartBg: 'linear-gradient(145deg, #4b6cf7, #3b5de7)',
  dashBtnStopBg: 'linear-gradient(145deg, #d9dde8, #c5cad7)',
  dashBtnText: '#fff',
  dashStatusColor: '#1a1a1a',
  dashSlotBg: '#fff',
  dashSlotActiveBg: 'rgba(75, 108, 247, 0.1)',
  dashSlotBorder: 'rgba(0,0,0,0.06)',
  dashSlotActiveBorder: 'rgba(75, 108, 247, 0.4)',
  dashSlotText: 'rgba(0,0,0,0.65)',
  dashSlotTextDim: 'rgba(0,0,0,0.45)',
  dashActionBtnBg: '#fff',
  dashActionBtnBorder: 'rgba(0,0,0,0.1)',
  dashActionBtnColor: 'rgba(0,0,0,0.65)',
  dashStopBtnBg: 'rgba(255,77,79,0.06)',
  dashStopBtnBorder: 'rgba(255,77,79,0.2)',
  dashStopBtnColor: '#ff4d4f'
}

export function getThemeTokens(mode: ThemeMode): ThemeTokens {
  return mode === 'dark' ? darkTokens : lightTokens
}

export const ThemeContext = createContext<ThemeTokens>(darkTokens)

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext)
}
