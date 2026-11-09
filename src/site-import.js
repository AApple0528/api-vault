import { ensureUniqueSiteIds } from './site-ids.js';
import { normalizeCustomGroups } from './site-groups.js';

export class StorageWriteError extends Error {
  constructor(writeError, rollbackErrors) {
    const rollbackFailed = rollbackErrors.length > 0;
    super(
      rollbackFailed
        ? '本地存储写入失败，且未能完整恢复旧值'
        : '本地存储写入失败，已恢复旧值',
      { cause: writeError }
    );
    this.name = 'StorageWriteError';
    this.code = rollbackFailed ? 'STORAGE_ROLLBACK_FAILED' : 'STORAGE_WRITE_FAILED';
    this.rollbackErrors = rollbackErrors;
  }
}

export function persistJsonArraysWithRollback(storage, entries) {
  const snapshots = entries.map(([key]) => ({ key, value: storage.getItem(key) }));
  const writtenKeys = [];

  try {
    entries.forEach(([key, items]) => {
      storage.setItem(key, JSON.stringify(items));
      writtenKeys.push(key);
    });
  } catch (writeError) {
    const rollbackErrors = [];
    for (let index = writtenKeys.length - 1; index >= 0; index--) {
      const snapshot = snapshots.find(item => item.key === writtenKeys[index]);
      try {
        if (snapshot.value === null) storage.removeItem(snapshot.key);
        else storage.setItem(snapshot.key, snapshot.value);
      } catch (error) {
        rollbackErrors.push({ key: snapshot.key, error });
      }
    }
    throw new StorageWriteError(writeError, rollbackErrors);
  }
}

export function getJsonImportFailureDialog(error) {
  if (error?.code === 'IMPORT_STORAGE_INCONSISTENT') {
    return {
      title: 'JSON 恢复未完成',
      message: '写入备份时发生错误，且未能完整恢复旧存储。设备中的存储状态可能不一致；当前页面仍保留导入前的数据，请重新打开应用并检查数据。'
    };
  }
  if (error?.code === 'IMPORT_STORAGE_FAILED') {
    return {
      title: 'JSON 恢复失败',
      message: '备份已通过校验，但无法写入本地存储。原有存储数据保持不变，请检查设备可用空间后重试。'
    };
  }
  return {
    title: 'JSON 校验失败',
    message: '所选文件不是有效的 API Vault 备份格式，请检查文件是否正确。'
  };
}

export function prepareAndPersistJsonImport(data, {
  currentGroups,
  normalizeSite,
  persist,
  seed = Date.now()
}) {
  if (!data || !Array.isArray(data.sites)) throw new Error('缺少 sites 数组');

  const importedGroups = Array.isArray(data.groups)
    ? data.groups.filter(group => typeof group === 'string' && group.trim()).map(group => group.trim())
    : [];
  const groups = normalizeCustomGroups(importedGroups.length > 0 ? importedGroups : currentGroups);
  const normalizedSites = data.sites.map(site => normalizeSite(site, groups));
  if (normalizedSites.some(site => site === null)) throw new Error('备份包含无效站点或网址');

  const idResult = ensureUniqueSiteIds(normalizedSites, seed);
  const nextState = { groups, sites: idResult.sites, repairedIdCount: idResult.repairedCount };
  try {
    persist(nextState);
  } catch (cause) {
    const rollbackFailed = cause?.code === 'STORAGE_ROLLBACK_FAILED';
    const error = new Error(
      rollbackFailed ? '本地存储状态可能不一致' : '无法写入本地存储',
      { cause }
    );
    error.code = rollbackFailed ? 'IMPORT_STORAGE_INCONSISTENT' : 'IMPORT_STORAGE_FAILED';
    error.rollbackErrors = cause?.rollbackErrors || [];
    throw error;
  }
  return nextState;
}
