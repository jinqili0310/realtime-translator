import { Language } from '../types';

// Simple language detection based on common patterns
export const detectLanguage = (text: string): Language | null => {
  // Remove whitespace and convert to lowercase for comparison
  const cleanText = text.trim().toLowerCase();
  
  // Check for common language patterns
  if (/[а-яё]/.test(cleanText)) {
    return { code: 'ru', name: 'Russian' };
  }
  if (/[一-龠]/.test(cleanText)) {
    return { code: 'ja', name: 'Japanese' };
  }
  if (/[가-힣]/.test(cleanText)) {
    return { code: 'ko', name: 'Korean' };
  }
  if (/[a-z]/.test(cleanText)) {
    return { code: 'en', name: 'English' };
  }
  
  return null;
}; 