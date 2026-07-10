'use client';

import { useState, useCallback, useEffect } from 'react';

const DEFAULT_SETTINGS = {
  baseURL: '',
  apiKey: '',
  selectedNormalModel: '',
  selectedReasoningModel: '',
  selectedVoice: 'alba',
  taskMode: 'hybrid',
  autoCompactEnabled: true,
  autoCompactThreshold: 70,
  newReadPath: '',
  newWritePath: '',
  newBlockedPath: '',
  newAllowedPrefix: '',
  newAutoApprove: '',
};

/**
 * useSettings — owns the settings-panel state and its config/models/voices
 * fetch+save logic, previously ~15 separate useState calls inline in page.tsx.
 */
export function useSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [securityConfig, setSecurityConfig] = useState(null);
  const [models, setModels] = useState([]);
  const [voices, setVoices] = useState([]);
  const [systemPromptType, setSystemPromptType] = useState('standard');

  const updateSettings = useCallback((patch) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const fetchModels = useCallback(() => {
    fetch(`/api/models`)
      .then(res => res.json())
      .then(data => setModels(data))
      .catch(() => {});
  }, []);

  const fetchVoices = useCallback(() => {
    fetch(`/api/voices`)
      .then(res => res.json())
      .then(data => {
        setVoices(data);
        if (data.length > 0) {
          const hasAlba = data.find(v => v.id === 'alba');
          updateSettings({ selectedVoice: hasAlba ? 'alba' : data[0].id });
        }
      })
      .catch(() => {});
  }, [updateSettings]);

  const fetchConfig = useCallback(() => {
    fetch(`/api/config`)
      .then(res => res.json())
      .then(data => {
        setSecurityConfig(data);
        if (data.litellm) {
          updateSettings({
            baseURL: data.litellm.baseURL || '',
            apiKey: data.litellm.apiKey || '',
            selectedNormalModel: data.litellm.selectedNormalModel || '',
            selectedReasoningModel: data.litellm.selectedReasoningModel || '',
            taskMode: data.litellm.taskMode || 'hybrid',
          });
        }
        if (data.systemPromptType) setSystemPromptType(data.systemPromptType);
        fetchModels();
      })
      .catch(err => console.error('Error loading config:', err));
  }, [fetchModels, updateSettings]);

  useEffect(() => { fetchConfig(); fetchVoices(); }, [fetchConfig, fetchVoices]);

  const saveAllSettings = useCallback(() => {
    const updatedConfig = {
      ...securityConfig,
      systemPromptType,
      litellm: {
        baseURL: settings.baseURL,
        apiKey: settings.apiKey,
        selectedNormalModel: settings.selectedNormalModel,
        selectedReasoningModel: settings.selectedReasoningModel,
        taskMode: settings.taskMode,
      },
    };
    fetch(`/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedConfig),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSecurityConfig(updatedConfig);
          fetchModels();
        }
      })
      .catch(err => console.error('Error saving settings:', err));
  }, [securityConfig, systemPromptType, settings, fetchModels]);

  // settingsKey (optional): a `settings` field to clear after a successful add,
  // e.g. the "new path" input that fed this addition.
  const addConfigItem = useCallback((field, subfield, val, settingsKey) => {
    if (!val.trim() || !securityConfig) return;
    const updated = { ...securityConfig };
    updated[field][subfield].push(val.trim());
    setSecurityConfig(updated);
    if (settingsKey) updateSettings({ [settingsKey]: '' });
  }, [securityConfig, updateSettings]);

  const removeConfigItem = useCallback((field, subfield, index) => {
    if (!securityConfig) return;
    const updated = { ...securityConfig };
    updated[field][subfield].splice(index, 1);
    setSecurityConfig(updated);
  }, [securityConfig]);

  return {
    settings, updateSettings,
    securityConfig, setSecurityConfig,
    models, voices,
    systemPromptType, setSystemPromptType,
    fetchConfig, fetchModels, fetchVoices,
    saveAllSettings, addConfigItem, removeConfigItem,
  };
}
