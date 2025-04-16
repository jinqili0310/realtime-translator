"use client";

import React, { useState, useEffect } from 'react';
import { Language } from '../types';

interface LanguageSelectionModalProps {
  isOpen: boolean;
  onClose: (selectedLanguages: { source: Language, target: Language } | null) => void;
  availableLanguages: Language[];
  initialSource?: Language;
  initialTarget?: Language;
}

const LanguageSelectionModal: React.FC<LanguageSelectionModalProps> = ({
  isOpen,
  onClose,
  availableLanguages,
  initialSource,
  initialTarget,
}) => {
  const [sourceLanguage, setSourceLanguage] = useState<Language | null>(initialSource || null);
  const [targetLanguage, setTargetLanguage] = useState<Language | null>(initialTarget || null);
  const [step, setStep] = useState<'source' | 'target'>('source');

  useEffect(() => {
    // Reset to initial state when modal opens
    if (isOpen) {
      setSourceLanguage(initialSource || null);
      setTargetLanguage(initialTarget || null);
      setStep('source');
    }
  }, [isOpen, initialSource, initialTarget]);

  const handleSourceSelect = (language: Language) => {
    setSourceLanguage(language);
    setStep('target');
  };

  const handleTargetSelect = (language: Language) => {
    setTargetLanguage(language);
    // Wait a bit to show the selection before closing
    setTimeout(() => {
      onClose({ 
        source: sourceLanguage!, 
        target: language 
      });
    }, 300);
  };

  const handleClose = () => {
    onClose(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg w-[90%] max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
            {step === 'source' ? 'Select Source Language' : 'Select Target Language'}
          </h2>
          <button 
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {step === 'source' 
              ? 'Select the language you want to translate from:' 
              : 'Select the language you want to translate to:'}
          </p>
          
          <div className="space-y-2">
            {availableLanguages
              .filter(lang => step === 'source' || lang.code !== sourceLanguage?.code)
              .map((language) => (
                <button
                  key={language.code}
                  onClick={() => step === 'source' 
                    ? handleSourceSelect(language) 
                    : handleTargetSelect(language)
                  }
                  className={`w-full text-left px-4 py-3 rounded-lg flex items-center justify-between
                    ${(step === 'source' && sourceLanguage?.code === language.code) || 
                      (step === 'target' && targetLanguage?.code === language.code)
                        ? 'bg-blue-100 dark:bg-blue-900'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  <span className="font-medium">{language.name}</span>
                  {((step === 'source' && sourceLanguage?.code === language.code) || 
                    (step === 'target' && targetLanguage?.code === language.code)) && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          {step === 'target' && (
            <button 
              onClick={() => setStep('source')}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            >
              Back
            </button>
          )}
          <button 
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 ml-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default LanguageSelectionModal; 