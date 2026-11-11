import { createIcons, ArrowUpRight, Bookmark, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, ExternalLink, Eye, EyeOff, FileJson, FileText, FileUp, FolderInput, GripVertical, ListFilter, Plus, Search, Settings, ShieldCheck, Trash2, User } from 'lucide';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { createExportActions, downloadInBrowser, shareInBrowser } from './export-actions.js';
import { bindLongPressSortable, reorderByIndex, serializeFormNotes } from './sortable.js';
import { selectSiteGroup, selectTopStat, siteMatchesFilters } from './site-filters.js';
import { createCredentialDisclosureState } from './credential-disclosure.js';
import { APP_VERSION, APP_VERSION_LABEL } from './app-version.js';
import { getLatestReleaseNotes } from './changelog.js';
import { getLocalDateKey, isCheckedInToday, migrateCheckInDates, normalizeCheckInDate, refreshCheckInStatus, serializeSitesWithCheckInDate, setCheckInForToday } from './check-in-state.js';
import { ensureUniqueSiteIds, migrateStoredSiteIds, toValidSiteId } from './site-ids.js';
import { getJsonImportFailureDialog, persistJsonArraysWithRollback, prepareAndPersistJsonImport } from './site-import.js';
import { clearAllSitesSafely, createUniqueSiteIdForState, mergeSitesForPersistence, partitionSitesForDisplay, persistBeforeCommit } from './site-storage.js';
import { normalizeCustomGroups, resolveSiteGroup, STATUS_FILTER_NAMES } from './site-groups.js';
import { isSafeHttpUrl, normalizeHttpUrl, validateGroupName, validateManualSiteUrl } from './site-validation.js';

const DocumentSaver = registerPlugin('DocumentSaver');
const isAndroid = Capacitor.getPlatform() === 'android';
if (isAndroid) document.documentElement.classList.add('native-android');

const PROJECT_REPOSITORY_URL = 'https://github.com/AApple0528/api-vault';
let viewportUpdateFrame = 0;
let focusVisibilityTimer = 0;

function keepControlVisible(control) {
  if (!(control instanceof HTMLElement)) return;
  const modal = control.closest('.keyboard-aware-modal');
  const panel = control.closest('.app-modal-panel');
  if (!modal || modal.classList.contains('hidden') || !panel) return;

  const panelRect = panel.getBoundingClientRect();
  const headerRect = panel.querySelector('.app-modal-header')?.getBoundingClientRect();
  const controlRect = control.getBoundingClientRect();
  const visibleTop = Math.max(panelRect.top + 12, (headerRect?.bottom || panelRect.top) + 8);
  const visibleBottom = panelRect.bottom - 16;

  if (controlRect.bottom > visibleBottom) {
    panel.scrollBy({ top: controlRect.bottom - visibleBottom, behavior: 'smooth' });
  } else if (controlRect.top < visibleTop) {
    panel.scrollBy({ top: controlRect.top - visibleTop, behavior: 'smooth' });
  }
}

function queueFocusedControlVisibility(control = document.activeElement) {
  if (!(control instanceof HTMLElement) || !control.closest('.keyboard-aware-modal')) return;
  requestAnimationFrame(() => keepControlVisible(control));
  window.clearTimeout(focusVisibilityTimer);
  focusVisibilityTimer = window.setTimeout(() => keepControlVisible(control), 280);
}

function syncVisualViewport() {
  if (viewportUpdateFrame) return;
  viewportUpdateFrame = requestAnimationFrame(() => {
    viewportUpdateFrame = 0;
    const viewport = window.visualViewport;
    const height = Math.max(1, viewport?.height || window.innerHeight);
    const offsetTop = Math.max(0, viewport?.offsetTop || 0);
    document.documentElement.style.setProperty('--app-visual-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--app-visual-viewport-top', `${offsetTop}px`);
    queueFocusedControlVisibility();
  });
}

syncVisualViewport();
window.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('scroll', syncVisualViewport);
document.addEventListener('focusin', event => queueFocusedControlVisibility(event.target));

const exportActions = createExportActions({
  preview({ content, title }) {
    document.getElementById('export-modal-title').textContent = title;
    document.getElementById('export-textarea').value = content;
    document.getElementById('export-modal').classList.remove('hidden');
  },
  close: closeExportModal,
  notify: showToast,
  async share(file) {
    if (!Capacitor.isNativePlatform()) return shareInBrowser(file);
    // Separate cached files prevent a later export from replacing a file that
    // an external app has not read yet. Never delete it on chooser completion.
    const { uri } = await Filesystem.writeFile({
      path: `exports/${crypto.randomUUID()}/${file.filename}`,
      data: file.content, encoding: Encoding.UTF8, directory: Directory.Cache,
      recursive: true
    });
    return Share.share({ title: file.filename, files: [uri], dialogTitle: '分享导出文件' });
  },
  save(file) {
    if (isAndroid) return DocumentSaver.save(file);
    return downloadInBrowser(file);
  }
});
document.getElementById('export-share-btn').onclick = exportActions.share;
document.getElementById('export-download-btn').onclick = exportActions.save;
if (isAndroid) document.getElementById('export-download-btn').textContent = '保存到文件（不分享）';

const iconSet = { ArrowUpRight, Bookmark, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, ExternalLink, Eye, EyeOff, FileJson, FileText, FileUp, FolderInput, GripVertical, ListFilter, Plus, Search, Settings, ShieldCheck, Trash2, User };

const STORAGE_KEY_SITES = 'api_vault_sites_v3';
    const STORAGE_KEY_GROUPS = 'api_vault_groups_v3';

    let defaultMask = true;
    let currentStatusFilter = '全部';
    let currentGroupFilter = null;
    let editingSiteId = null;
    let tempFormNotes = [];
    const credentialDisclosure = createCredentialDisclosureState();
    let releaseGroupSort = () => {};
    let releaseNoteSort = () => {};

    function readStoredJson(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch (error) {
        console.warn(`Unable to read ${key}`, error);
        return fallback;
      }
    }

    let customGroups = normalizeCustomGroups(readStoredJson(STORAGE_KEY_GROUPS, null));

    const defaultSampleSites = [
      {
        id: 1,
        name: 'SiliconFlow 硅基流动',
        url: 'https://cloud.siliconflow.cn',
        group: '主力站',
        tags: ['主力', 'DeepSeek满血'],
        needCheckIn: true,
        lastCheckInDate: null,
        notes: [
          { label: '主用凭证', value: 'sk-sf-89f23a90c11b4e7d', masked: true },
          { label: '登录账号', value: 'pingping@studio.com', masked: false }
        ],
        desc: '平时拆剧本主力站，新号送14块钱额度。'
      },
      {
        id: 2,
        name: 'OpenRouter',
        url: 'https://openrouter.ai',
        group: '主力站',
        tags: ['模型全', '按量计费'],
        needCheckIn: false,
        lastCheckInDate: null,
        notes: [
          { label: '默认串码', value: 'sk-or-v1-7782910a9x', masked: true }
        ],
        desc: '用来调各种冷门模型对比效果。'
      },
      {
        id: 3,
        name: 'LinuxDo 公益中转',
        url: 'https://linux.do',
        group: '公益站',
        tags: ['每日签到', '白嫖'],
        needCheckIn: true,
        lastCheckInDate: getLocalDateKey(),
        notes: [
          { label: '福利码', value: 'sk-free-992011a', masked: true },
          { label: '密码备忘', value: 'Jiang180cm!', masked: true }
        ],
        desc: '每天零点刷新签到领额度，偶尔抽风。'
      }
    ];

    function normalizeSite(site, groups = customGroups) {
      if (!site || typeof site !== 'object' || !isSafeHttpUrl(site.url)) return null;
      const notes = Array.isArray(site.notes) ? site.notes.filter(note => note && typeof note === 'object').map(note => ({
        label: String(note.label || ''), value: String(note.value || ''), masked: Boolean(note.masked)
      })) : [];
      return {
        id: toValidSiteId(site.id),
        name: String(site.name || '未命名站点'),
        url: normalizeHttpUrl(site.url),
        group: resolveSiteGroup(site.group, groups),
        tags: Array.isArray(site.tags) ? site.tags.map(String) : [],
        needCheckIn: Boolean(site.needCheckIn),
        lastCheckInDate: normalizeCheckInDate(site),
        checkedInToday: isCheckedInToday(site),
        notes,
        desc: String(site.desc || '')
      };
    }

    const storedSites = readStoredJson(STORAGE_KEY_SITES, null);
    let storedSiteSource = storedSites;
    if (Array.isArray(storedSites)) {
      const migrationSeed = Date.now();
      try {
        storedSiteSource = migrateStoredSiteIds(localStorage, STORAGE_KEY_SITES, storedSites, migrationSeed).sites;
      } catch (error) {
        storedSiteSource = ensureUniqueSiteIds(storedSites, migrationSeed).sites;
        console.error('Unable to persist site ID migration', error);
        showToast('站点 ID 已在本次运行中修复，但未能写入本地存储');
      }
    }
    if (Array.isArray(storedSiteSource)) {
      const migration = migrateCheckInDates(storedSiteSource);
      storedSiteSource = migration.sites;
      if (migration.changed) {
        try {
          localStorage.setItem(STORAGE_KEY_SITES, JSON.stringify(storedSiteSource));
        } catch (error) {
          console.error('Unable to persist check-in date migration', error);
          showToast('签到状态迁移未能写入本地存储');
        }
      }
    }
    const partitionedSites = Array.isArray(storedSiteSource)
      ? partitionSitesForDisplay(storedSiteSource, site => normalizeSite(site, customGroups))
      : { sites: defaultSampleSites, preservedSites: [] };
    let preservedInvalidSites = partitionedSites.preservedSites;
    let sites = ensureUniqueSiteIds(partitionedSites.sites).sites;

    function persistAppState(nextSites, nextGroups, preservedSites = preservedInvalidSites) {
      persistJsonArraysWithRollback(localStorage, [
        [STORAGE_KEY_SITES, mergeSitesForPersistence(serializeSitesWithCheckInDate(nextSites), preservedSites)],
        [STORAGE_KEY_GROUPS, nextGroups]
      ]);
    }

    function createNextSiteId() {
      return createUniqueSiteIdForState(sites, preservedInvalidSites);
    }

    function saveToStorage(nextSites, nextGroups) {
      return persistBeforeCommit({
        persist: () => persistAppState(nextSites, nextGroups),
        commit: () => {
          sites = nextSites;
          customGroups = nextGroups;
        },
        notifyFailure(error, storageMayBeInconsistent) {
          showToast(storageMayBeInconsistent
            ? '保存失败，存储状态可能不一致，请重新打开应用检查数据'
            : '本地存储失败，修改未保存，请检查设备空间');
        },
        reportError: error => console.error('Unable to persist API Vault data', error)
      }).ok;
    }

    function getAllFilterTabs() {
      return ['全部', ...customGroups];
    }

    function renderCategories() {
      const container = document.getElementById('category-tabs');
      const tabs = getAllFilterTabs();
      if (currentGroupFilter && !customGroups.includes(currentGroupFilter)) currentGroupFilter = null;

      container.innerHTML = tabs.map(cat => {
        const active = cat === '全部'
          ? currentStatusFilter === '全部' && !currentGroupFilter
          : cat === currentGroupFilter;
        return `<button onclick="setCategoryByIndex(${tabs.indexOf(cat)})" class="px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${ active ? 'bg-text text-card shadow-sm' : 'bg-card border border-border text-muted hover:text-text' }">${escapeHtml(cat)}</button>`;
      }).join('');

      document.getElementById('card-stat-all').classList.toggle('border-accent', currentStatusFilter === '全部');
      document.getElementById('card-stat-pending').classList.toggle('border-accent', currentStatusFilter === '待签到');
      document.getElementById('card-stat-done').classList.toggle('border-sage', currentStatusFilter === '已签到');
    }

    function setCategory(cat) {
      if (cat === '全部') {
        ({ status: currentStatusFilter, group: currentGroupFilter } = selectTopStat('全部'));
      } else if (STATUS_FILTER_NAMES.includes(cat)) {
        ({ status: currentStatusFilter, group: currentGroupFilter } = selectTopStat(cat));
      } else if (customGroups.includes(cat)) {
        ({ status: currentStatusFilter, group: currentGroupFilter } = selectSiteGroup(cat));
      }
      renderCategories();
      renderGroupPickerList();
      renderSites();
    }

    function setCategoryByIndex(index) {
      const category = getAllFilterTabs()[Number(index)];
      if (category !== undefined) setCategory(category);
    }

    function copySiteNote(siteId, noteIndex) {
      const site = sites.find(item => item.id === Number(siteId));
      const note = site && site.notes[Number(noteIndex)];
      if (note) copyText(note.value);
    }

    function openSiteLink(url) {
      const safeUrl = normalizeHttpUrl(url);
      if (!safeUrl) return false;
      if (Capacitor.isNativePlatform()) {
        void Browser.open({ url: safeUrl });
      } else {
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
      }
      return true;
    }

    function openProjectRepository(event) {
      event?.preventDefault();
      openSiteLink(PROJECT_REPOSITORY_URL);
    }

    function copyProjectRepository() {
      copyText(PROJECT_REPOSITORY_URL);
    }

    function renderReleaseInfo() {
      const version = document.getElementById('app-version');
      const content = document.getElementById('changelog-content');
      const release = getLatestReleaseNotes(APP_VERSION_LABEL);
      if (version) version.textContent = release?.version || APP_VERSION_LABEL;
      if (content) {
        content.innerHTML = release?.changes?.length
          ? release.changes.map(change => `<li>${escapeHtml(change)}</li>`).join('')
          : '<li>暂无更新内容</li>';
      }
    }

    function updateStats() {
      document.getElementById('stat-total').innerText = sites.length;
      const pending = sites.filter(s => s.needCheckIn && !s.checkedInToday).length;
      const done = sites.filter(s => s.needCheckIn && s.checkedInToday).length;
      document.getElementById('stat-pending').innerText = pending;
      document.getElementById('stat-done').innerText = done;
    }

    function maskString(str) {
      if (!str) return '';
      if (str.length <= 6) return '••••••';
      return str.slice(0, 4) + '••••' + str.slice(-3);
    }

    function escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function renderSites() {
      sites = refreshCheckInStatus(sites);
      updateStats();
      const q = document.getElementById('search-input').value.trim().toLowerCase();
      const list = document.getElementById('site-list');

      const filtered = sites.filter(site => siteMatchesFilters(site, {
        status: currentStatusFilter,
        group: currentGroupFilter,
        query: q
      }));

      if (filtered.length === 0) {
        const filterLabel = [currentGroupFilter, currentStatusFilter !== '全部' ? currentStatusFilter : null].filter(Boolean).join(' · ') || '全部';
        list.innerHTML = `<div class="text-center py-12 text-xs text-muted">当前「${escapeHtml(filterLabel)}」下没有匹配的站点书签</div>`;
        return;
      }

      list.innerHTML = filtered.map(site => {
        const credentialsExpanded = credentialDisclosure.isExpanded(site.id);
        const safeUrl = normalizeHttpUrl(site.url);
        return `
        <div class="bg-card border border-border rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              ${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(site.name)}" class="font-serif font-semibold text-base text-text hover:text-accent transition inline-flex items-center gap-1 min-w-0 max-w-full">
                <span class="truncate min-w-0">${escapeHtml(site.name)}</span>
                <i data-lucide="arrow-up-right" class="w-4 h-4 text-muted shrink-0"></i>
              </a>` : `<span class="font-serif font-semibold text-base text-text truncate min-w-0" title="${escapeHtml(site.name)}">${escapeHtml(site.name)}</span>`}
              <div class="text-[11px] text-muted font-mono mt-0.5 truncate">${escapeHtml(site.url.replace(/^https?:\/\//, ''))}</div>
            </div>

            ${site.needCheckIn ? `
              <button onclick="toggleCheckIn(${site.id})" class="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1 transition ${
                site.checkedInToday
                  ? 'bg-sageLight text-sage'
                  : 'bg-accentLight text-accent hover:opacity-80'
              }">
                <i data-lucide="${site.checkedInToday ? 'check-circle-2' : 'clock'}" class="w-3.5 h-3.5"></i>
                ${site.checkedInToday ? '今日已签' : '去签到'}
              </button>
            ` : ''}
          </div>

          <div class="flex items-center justify-between gap-2 min-w-0">
            <div class="flex flex-wrap items-center gap-1.5 min-w-0">
              <span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-bg border border-border text-text">${escapeHtml(site.group)}</span>${(site.tags || []).map(t => `<span class="text-[10px] text-muted px-2 py-0.5 rounded-md bg-bg">#${escapeHtml(t)}</span>`).join('')}
            </div>
            ${site.notes && site.notes.length > 0 ? `
              <button type="button" onclick="toggleSiteCredentials(${site.id})"
                class="credential-toggle w-9 h-9 -mr-1 shrink-0 flex items-center justify-center text-muted hover:text-text transition"
                aria-expanded="${credentialsExpanded}" aria-controls="site-credentials-${site.id}"
                title="${credentialsExpanded ? '收起凭据信息' : '展开凭据信息'}" aria-label="${credentialsExpanded ? '收起凭据信息' : '展开凭据信息'}">
                <i data-lucide="chevron-down" class="w-5 h-5 transition-transform duration-200 ${credentialsExpanded ? 'rotate-180' : ''}"></i>
              </button>
            ` : ''}
          </div>

          ${site.notes && site.notes.length > 0 ? `
            <div id="site-credentials-${site.id}" class="credential-panel ${credentialsExpanded ? 'is-expanded' : ''}" ${credentialsExpanded ? '' : 'hidden'}>
              <div class="bg-bg/70 rounded-xl p-2.5 space-y-2 border border-border/70">
              ${site.notes.map((n, idx) => `
                <div class="flex items-center justify-between text-xs gap-2">
                  <span class="text-muted shrink-0 max-w-[90px] truncate">${escapeHtml(n.label)}</span>
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="font-mono text-[11px] truncate text-text">${n.masked ? maskString(n.value) : escapeHtml(n.value)}</span>
                    <button onclick="toggleNoteMask(${site.id},${idx})" class="p-1 text-muted hover:text-text" title="显示/隐藏">
                      <i data-lucide="${n.masked ? 'eye-off' : 'eye'}" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="copySiteNote(${site.id},${idx})" class="px-2 py-0.5 rounded bg-card border border-border text-[11px] text-text hover:border-accent transition shrink-0">
                      复制
                    </button>
                  </div>
                </div>
              `).join('')}
              </div>
            </div>
          ` : ''}

          <div class="flex items-center justify-between pt-1 text-[11px] text-muted border-t border-border/50">
            <span class="truncate pr-3">${escapeHtml(site.desc || '暂无备注')}</span>
            <div class="flex items-center gap-3 shrink-0">
              <button onclick="openSiteModal(${site.id})" class="text-text hover:text-accent font-medium">编辑</button>
              <button onclick="confirmDeleteSite(${site.id})" class="text-muted hover:text-red-600">删除</button>
            </div>
          </div>
        </div>
      `;
      }).join('');

      createIcons({ icons: iconSet });
    }

    function toggleSiteCredentials(siteId) {
      credentialDisclosure.toggle(Number(siteId));
      renderSites();
    }

    function toggleCheckIn(id) {
      const s = sites.find(item => item.id === id);
      if (!s) return;
      const today = getLocalDateKey();
      const updatedSite = setCheckInForToday(s, today);
      const checkedInToday = updatedSite.checkedInToday;
      const nextSites = sites.map(item => item.id === id ? updatedSite : item);
      if (!saveToStorage(nextSites, customGroups)) return;

      if (checkedInToday) {
        openSiteLink(s.url);
        showToast('已打开站点并标记为「今日已签」');
      } else {
        showToast('已重置为「待签到」');
      }
      renderSites();
    }

    function toggleNoteMask(siteId, noteIdx) {
      const s = sites.find(item => item.id === siteId);
      if (s && s.notes[noteIdx]) {
        const nextSites = sites.map(item => item.id === siteId ? {
          ...item,
          notes: item.notes.map((note, index) => index === noteIdx ? { ...note, masked: !note.masked } : note)
        } : item);
        if (!saveToStorage(nextSites, customGroups)) return;
        renderSites();
      }
    }

    function toggleDefaultMask(checked) {
      const nextSites = sites.map(site => ({
        ...site,
        notes: (site.notes || []).map(note => ({ ...note, masked: checked }))
      }));
      if (!saveToStorage(nextSites, customGroups)) {
        document.getElementById('toggle-mask').checked = defaultMask;
        return;
      }
      defaultMask = checked;
      renderSites();
      showToast(checked ? '已开启全部便签打码' : '已显示全部便签明文');
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板')).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
    }

    function fallbackCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        const copied = document.execCommand('copy');
        showToast(copied ? '已复制到剪贴板' : '复制未完成，请长按文本手动复制');
      } catch {
        showToast('复制未完成，请长按文本手动复制');
      } finally {
        ta.remove();
      }
    }

    function confirmDeleteSite(id) {
      const s = sites.find(item => item.id === id);
      if (!s) return;
      showDialog(
        '确认删除站点？',
        `即将删除「${s.name}」及其包含的所有随手记便签，删除后不可恢复。`,
        [
          { text: '取消', class: 'px-3.5 py-1.5 rounded-xl bg-bg text-muted text-xs', action: closeDialog },
          { text: '确认删除', class: 'px-3.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-medium', action: () => {
            const nextSites = sites.filter(item => item.id !== id);
            if (!saveToStorage(nextSites, customGroups)) return;
            credentialDisclosure.remove(id);
            renderSites();
            closeDialog();
            showToast('已删除该站点');
          }}
        ]
      );
    }

    function confirmClearAllData() {
      showDialog(
        '清空所有站点数据？',
        '此操作将彻底清空当前所有的站点书签与随手记便签（非常适合在正式使用前清理默认示例数据）。请确认是否继续？',
        [
          { text: '取消', class: 'px-3.5 py-1.5 rounded-xl bg-bg text-muted text-xs', action: closeDialog },
          { text: '确认清空', class: 'px-3.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-medium', action: () => {
            clearAllSitesSafely({
              persist: () => persistAppState([], customGroups, []),
              commit: () => {
                sites = [];
                preservedInvalidSites = [];
                credentialDisclosure.clear();
                renderSites();
                closeDialog();
              },
              notify: showToast,
              reportError: error => console.error('Unable to clear API Vault data', error)
            });
          }}
        ]
      );
    }

    function populateGroupSelect(selectedGroup) {
      const select = document.getElementById('form-group');
      select.innerHTML = customGroups.map(g => `<option value="${escapeHtml(g)}" ${g === selectedGroup ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('');
    }

    function renderFormNotes() {
      const container = document.getElementById('form-notes-container');
      releaseNoteSort();
      container.innerHTML = tempFormNotes.map((note, idx) => `
        <div data-sort-index="${idx}" class="sortable-item flex items-center gap-1.5 min-w-0">
          <button type="button" data-sort-handle class="sort-handle p-1 text-muted hover:text-accent shrink-0" title="长按拖动便签" aria-label="长按拖动便签">
            <i data-lucide="grip-vertical" class="w-4 h-4 pointer-events-none"></i>
          </button>
          <input type="text" value="${escapeHtml(note.label)}" oninput="updateFormNote(${idx}, 'label', this.value)" placeholder="标签" class="w-20 sm:w-24 shrink-0 bg-bg border border-border rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent">
          <input type="text" value="${escapeHtml(note.value)}" oninput="updateFormNote(${idx}, 'value', this.value)" placeholder="填写内容 (如 sk-xxx 或账号)..." class="flex-1 min-w-0 bg-bg border border-border rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-accent">
          <button type="button" onclick="removeFormNoteRow(${idx})" class="p-1.5 text-muted hover:text-red-600 shrink-0" title="删除此行">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `).join('');
      createIcons({ icons: iconSet });
      releaseNoteSort = bindLongPressSortable(container, {
        onReorder(order) {
          tempFormNotes = reorderByIndex(tempFormNotes, order);
          renderFormNotes();
        }
      });
    }

    function addFormNoteRow() {
      tempFormNotes.push({ label: `便签 ${tempFormNotes.length + 1}`, value: '', masked: defaultMask });
      renderFormNotes();
    }

    function updateFormNote(index, field, value) {
      if ((field === 'label' || field === 'value') && tempFormNotes[Number(index)]) {
        tempFormNotes[Number(index)][field] = value;
      }
    }

    function removeFormNoteRow(idx) {
      if (tempFormNotes.length <= 1) {
        tempFormNotes[0] = { label: '便签 1', value: '', masked: defaultMask };
      } else {
        tempFormNotes.splice(idx, 1);
      }
      renderFormNotes();
    }

    function openSiteModal(siteId = null) {
      editingSiteId = siteId;
      clearSiteUrlError();
      const titleEl = document.getElementById('site-modal-title');

      if (siteId) {
        const s = sites.find(item => item.id === siteId);
        if (!s) return;
        titleEl.innerText = '编辑站点';
        document.getElementById('form-name').value = s.name;
        document.getElementById('form-url').value = s.url;
        populateGroupSelect(s.group);
        document.getElementById('form-tags').value = (s.tags || []).join(' ');
        document.getElementById('form-checkin').checked = !!s.needCheckIn;
        document.getElementById('form-desc').value = s.desc || '';
        tempFormNotes = (s.notes && s.notes.length > 0)
          ? s.notes.map(n => ({ label: n.label, value: n.value, masked: Boolean(n.masked) }))
          : [{ label: '便签 1', value: '', masked: defaultMask }, { label: '便签 2', value: '', masked: defaultMask }];
      } else {
        titleEl.innerText = '新增站点';
        document.getElementById('form-name').value = '';
        document.getElementById('form-url').value = '';
        populateGroupSelect(customGroups[0] || '默认分组');
        document.getElementById('form-tags').value = '';
        document.getElementById('form-checkin').checked = true;
        document.getElementById('form-desc').value = '';
        tempFormNotes = [
          { label: '便签 1', value: '', masked: defaultMask },
          { label: '便签 2', value: '', masked: defaultMask }
        ];
      }

      renderFormNotes();
      document.getElementById('site-modal').classList.remove('hidden');
    }

    function closeSiteModal() {
      document.getElementById('site-modal').classList.add('hidden');
      editingSiteId = null;
    }

    function clearSiteUrlError() {
      const input = document.getElementById('form-url');
      input.classList.remove('border-red-600', 'focus:border-red-600');
      input.setAttribute('aria-invalid', 'false');
      const error = document.getElementById('form-url-error');
      error.textContent = '';
      error.classList.add('hidden');
    }

    function saveSite() {
      const name = document.getElementById('form-name').value.trim() || '未命名站点';
      const urlInput = document.getElementById('form-url');
      const urlError = document.getElementById('form-url-error');
      const urlResult = validateManualSiteUrl(urlInput.value);
      urlInput.classList.toggle('border-red-600', !urlResult.valid);
      urlInput.classList.toggle('focus:border-red-600', !urlResult.valid);
      urlInput.setAttribute('aria-invalid', String(!urlResult.valid));
      urlError.textContent = urlResult.valid ? '' : (urlResult.reason === 'required' ? '请输入网址' : '网址格式不正确');
      urlError.classList.toggle('hidden', urlResult.valid);
      if (!urlResult.valid) return;
      const url = urlResult.url;

      const group = document.getElementById('form-group').value || customGroups[0] || '默认分组';
      const tagsRaw = document.getElementById('form-tags').value.trim();
      const tags = tagsRaw ? tagsRaw.split(/[\s,，]+/).filter(Boolean) : [];
      const needCheckIn = document.getElementById('form-checkin').checked;
      const desc = document.getElementById('form-desc').value.trim();

      // Existing and new sites both save the temporary form order; editing does
      // not mutate persisted notes until the user confirms the whole form.
      const validNotes = serializeFormNotes(tempFormNotes);

      let nextSites;
      let successMessage;
      if (editingSiteId) {
        const idx = sites.findIndex(item => item.id === editingSiteId);
        if (idx === -1) return showToast('未找到需要修改的站点');
        nextSites = sites.map((site, index) => index === idx ? {
            ...site,
            name, url, group, tags, needCheckIn,
            notes: validNotes,
            desc
          } : site);
        successMessage = '站点修改已保存';
      } else {
        nextSites = [{
          id: createNextSiteId(),
          name, url, group, tags, needCheckIn,
          lastCheckInDate: null,
          notes: validNotes,
          desc
        }, ...sites];
        successMessage = '新站点已添加';
      }

      if (!saveToStorage(nextSites, customGroups)) return;
      closeSiteModal();
      renderCategories();
      renderSites();
      showToast(successMessage);
    }

    function openGroupModal() {
      document.getElementById('new-group-input').value = '';
      renderGroupManageList();
      document.getElementById('group-modal').classList.remove('hidden');
    }

    function closeGroupModal() {
      document.getElementById('group-modal').classList.add('hidden');
      renderCategories();
      renderSites();
    }

    function renderGroupManageList() {
      const list = document.getElementById('group-manage-list');
      releaseGroupSort();
      list.innerHTML = customGroups.map((g, idx) => `
        <div data-sort-index="${idx}" class="sortable-item flex items-center justify-between bg-bg border border-border rounded-xl pl-1.5 pr-3 py-2">
          <button type="button" data-sort-handle class="sort-handle p-1.5 text-muted hover:text-accent shrink-0" title="长按拖动分组" aria-label="长按拖动分组">
            <i data-lucide="grip-vertical" class="w-4 h-4 pointer-events-none"></i>
          </button>
          <input type="text" value="${escapeHtml(g)}" onchange="renameCustomGroup(${idx}, this.value)" class="bg-transparent text-sm font-medium focus:outline-none focus:text-accent flex-1 mr-2">
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[11px] text-muted">${sites.filter(s => s.group === g).length} 个站点</span>
            <button onclick="deleteCustomGroup(${idx})" class="p-1 text-muted hover:text-red-600" title="删除分组">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      `).join('');
      createIcons({ icons: iconSet });
      releaseGroupSort = bindLongPressSortable(list, {
        onReorder(order) {
          const nextGroups = reorderByIndex(customGroups, order);
          if (!saveToStorage(sites, nextGroups)) {
            renderGroupManageList();
            return;
          }
          renderGroupManageList();
          renderCategories();
          renderGroupPickerList();
          showToast('分组顺序已保存');
        }
      });
    }

    function openGroupPicker() {
      renderGroupPickerList();
      document.getElementById('group-picker-modal').classList.remove('hidden');
    }

    function closeGroupPicker() {
      document.getElementById('group-picker-modal').classList.add('hidden');
    }

    function selectGroupFromPicker(index) {
      const numericIndex = Number(index);
      const group = numericIndex < 0 ? null : (customGroups[numericIndex] || null);
      ({ status: currentStatusFilter, group: currentGroupFilter } = selectSiteGroup(group));
      closeGroupPicker();
      renderCategories();
      renderSites();
    }

    function renderGroupPickerList() {
      const list = document.getElementById('group-picker-list');
      if (!list) return;
      if (customGroups.length === 0) {
        list.innerHTML = '<div class="py-8 text-center text-xs text-muted">暂无自定义分组，请先在分组管理中添加</div>';
        return;
      }
      const rows = [{ name: '全部分组', index: -1 }, ...customGroups.map((name, index) => ({ name, index }))];
      list.innerHTML = rows.map(row => {
        const active = row.index < 0 ? !currentGroupFilter : row.name === currentGroupFilter;
        return `<button type="button" onclick="selectGroupFromPicker(${row.index})" class="w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition ${active ? 'border-accent bg-accentLight/60 text-accent' : 'border-border bg-bg text-text hover:border-accent/50'}">
          <span class="text-sm font-medium truncate">${escapeHtml(row.name)}</span>
          ${active ? '<i data-lucide="check" class="w-4 h-4 shrink-0"></i>' : ''}
        </button>`;
      }).join('');
      createIcons({ icons: iconSet });
    }

    function addCustomGroup() {
      const input = document.getElementById('new-group-input');
      const validation = validateGroupName(input.value);
      const val = validation.name;
      if (!val) return showToast('请输入分组名称');
      if (!validation.valid) return showToast('分组名称过长，中文和 emoji 按 2 个字符计算，最多 16 个字符宽度');
      if (['全部', ...STATUS_FILTER_NAMES, ...customGroups].includes(val)) {
        return showToast('该分组名称已存在');
      }
      const nextGroups = [...customGroups, val];
      if (!saveToStorage(sites, nextGroups)) return;
      input.value = '';
      renderGroupManageList();
      showToast('已添加分组');
    }

    function renameCustomGroup(idx, newName) {
      const validation = validateGroupName(newName);
      const val = validation.name;
      const oldName = customGroups[idx];
      if (!val || val === oldName) return renderGroupManageList();
      if (!validation.valid) {
        showToast('分组名称过长，中文和 emoji 按 2 个字符计算，最多 16 个字符宽度');
        return;
      }
      if (['全部', ...STATUS_FILTER_NAMES, ...customGroups].includes(val)) {
        showToast('分组名称冲突');
        return renderGroupManageList();
      }
      const nextGroups = customGroups.map((group, index) => index === idx ? val : group);
      const nextSites = sites.map(site => site.group === oldName ? { ...site, group: val } : site);
      if (!saveToStorage(nextSites, nextGroups)) {
        renderGroupManageList();
        return;
      }
      if (currentGroupFilter === oldName) currentGroupFilter = val;
      renderGroupManageList();
      renderCategories();
      renderGroupPickerList();
      showToast(`已重命名为「${val}」`);
    }

    function deleteCustomGroup(idx) {
      if (customGroups.length <= 1) {
        return showToast('至少需要保留一个自定义分组');
      }
      const target = customGroups[idx];
      const fallback = customGroups.find((_, i) => i !== idx);
      const nextGroups = customGroups.filter((_, index) => index !== idx);
      const nextSites = sites.map(site => site.group === target ? { ...site, group: fallback } : site);
      if (!saveToStorage(nextSites, nextGroups)) return;
      if (currentGroupFilter === target) currentGroupFilter = null;
      renderGroupManageList();
      renderCategories();
      renderGroupPickerList();
      showToast(`已删除「${target}」，原站点已移至「${fallback}」`);
    }

    function triggerBookmarkInput() {
      const input = document.getElementById('bookmark-file-input');
      input.value = '';
      input.click();
    }

    function handleBookmarkImport(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const fileName = file.name.toLowerCase();
      if (!fileName.endsWith('.html') && !fileName.endsWith('.htm')) {
        return showDialog('文件格式错误', `您选择的文件「${file.name}」不是有效的浏览器书签文件。\n请上传 .html 或 .htm 格式文件。`, [
          { text: '知道了', class: 'px-4 py-1.5 rounded-xl bg-accent text-white text-xs font-medium', action: closeDialog }
        ]);
      }

      const reader = new FileReader();
      reader.onload = function(e) {
        const content = e.target.result || '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const links = Array.from(doc.querySelectorAll('a'));

        if (links.length === 0) {
          return showDialog('导入校验失败', '未在该文件中检测到任何有效的书签链接，请确认文件内容是否正确。', [
            { text: '关闭', class: 'px-4 py-1.5 rounded-xl bg-accent text-white text-xs font-medium', action: closeDialog }
          ]);
        }

        let importedCount = 0;
        let skippedCount = 0;
        const defaultGroup = customGroups[0] || '主力站';
        let nextSites = [...sites];

        links.forEach((a, idx) => {
          const href = (a.getAttribute('href') || '').trim();
          const title = (a.textContent || '').trim() || '未命名书签';

          if (!isSafeHttpUrl(href)) {
            skippedCount++;
            return;
          }

          let folderTag = '书签导入';
          const parentDl = a.closest('dl');
          if (parentDl && parentDl.previousElementSibling && parentDl.previousElementSibling.tagName === 'H3') {
            folderTag = parentDl.previousElementSibling.textContent.trim() || '书签导入';
          }

          nextSites.unshift({
            id: createUniqueSiteIdForState(nextSites, preservedInvalidSites),
            name: title,
           url: normalizeHttpUrl(href),
            group: defaultGroup,
            tags: [folderTag],
            needCheckIn: false,
            lastCheckInDate: null,
            notes: [
              { label: '便签 1', value: '暂无内容', masked: false }
            ],
            desc: '由浏览器书签自动导入'
          });
          importedCount++;
        });

        if (!saveToStorage(nextSites, customGroups)) return;
        renderCategories();
        renderSites();

        showDialog(
          '书签导入校验完成',
          `文件名称：${file.name}\n成功导入：${importedCount} 条站点（已归入「${defaultGroup}」）\n过滤无效链接：${skippedCount} 条`,
          [
            { text: '去看站点', class: 'px-4 py-1.5 rounded-xl bg-accent text-white text-xs font-medium', action: () => {
              closeDialog();
              switchTab('sites');
            }}
          ]
        );
      };
      reader.readAsText(file);
    }

    // 导入 JSON 备份文件恢复数据
    function triggerJsonInput() {
      const input = document.getElementById('json-file-input');
      input.value = '';
      input.click();
    }

    function handleJsonImport(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result || '{}');
          if (!Array.isArray(data.sites)) {
            throw new Error('缺少 sites 数组');
          }
          const importedState = prepareAndPersistJsonImport(data, {
            currentGroups: customGroups,
            normalizeSite,
            persist({ sites: importedSites, groups: importedGroups }) {
              persistAppState(importedSites, importedGroups, []);
            }
          });
          customGroups = importedState.groups;
          credentialDisclosure.clear();
          sites = importedState.sites;
          preservedInvalidSites = [];
          renderCategories();
          renderSites();
          showDialog(
            'JSON 备份恢复成功',
            `已从「${file.name}」成功恢复 ${sites.length} 个站点及 ${customGroups.length} 个自定义分组。`,
            [
              { text: '完成', class: 'px-4 py-1.5 rounded-xl bg-accent text-white text-xs font-medium', action: () => {
                closeDialog();
                switchTab('sites');
              }}
            ]
          );
        } catch (err) {
          if (err?.code === 'IMPORT_STORAGE_FAILED' || err?.code === 'IMPORT_STORAGE_INCONSISTENT') {
            console.error('Unable to restore JSON backup', err);
          }
          const failureDialog = getJsonImportFailureDialog(err);
          showDialog(failureDialog.title, failureDialog.message, [
            { text: '关闭', class: 'px-4 py-1.5 rounded-xl bg-accent text-white text-xs font-medium', action: closeDialog }
          ]);
        }
      };
      reader.readAsText(file);
    }

    // Only prepare a preview. The explicit buttons perform share/save/copy.
    function exportData(type) {
      let content = '';
      let filename = '';
      let mime = 'text/plain;charset=utf-8';
      const dateStr = new Date().toISOString().slice(0, 10);
      const sep = String.fromCharCode(124);

      if (type === 'json') {
        content = JSON.stringify({ version: APP_VERSION, exportedAt: new Date().toISOString(), groups: customGroups, sites: serializeSitesWithCheckInDate(sites) }, null, 2);
        filename = `api-vault-backup-${dateStr}.json`;
        mime = 'application/json;charset=utf-8';
      } else {
        const lines = [
          `# API Vault 站点书签清单`,
          `> 导出时间：${dateStr} ${sep} 总站点数：${sites.length}`,
          ``
        ];
        sites.forEach((s, i) => {
          lines.push(`## ${i + 1}. [${s.name}](${s.url})`);
          lines.push(`- **分组**：${s.group} ${sep} **标签**：${(s.tags || []).join(', ') || '无'} ${sep} **每日签到**：${s.needCheckIn ? (s.checkedInToday ? '今日已签' : '待签到') : '无需签到'}`);
          if (s.notes && s.notes.length) {
            lines.push(`- **随手记便签**：`);
            s.notes.forEach(n => lines.push(`  - \`${n.label}\`: \`${n.value}\``));
          }
          if (s.desc) lines.push(`- **备注**：${s.desc}`);
          lines.push(``);
        });
        content = lines.join('\n');
        filename = `api-vault-list-${dateStr}.md`;
        mime = 'text/markdown;charset=utf-8';
      }

      exportActions.open({ content, filename, mime,
        title: type === 'json' ? '导出 JSON 备份' : '导出 Markdown 文档' });
    }

    function closeExportModal() {
      document.getElementById('export-modal').classList.add('hidden');
    }

    function copyExportContent() {
      const val = document.getElementById('export-textarea').value;
      copyText(val);
    }

    function showDialog(title, msg, actions) {
      document.getElementById('dialog-title').innerText = title;
      document.getElementById('dialog-msg').innerText = msg;
      const actContainer = document.getElementById('dialog-actions');
      actContainer.innerHTML = '';
      actions.forEach(act => {
        const btn = document.createElement('button');
        btn.className = act.class;
        btn.innerText = act.text;
        btn.onclick = act.action;
        actContainer.appendChild(btn);
      });
      document.getElementById('dialog-modal').classList.remove('hidden');
    }

    function closeDialog() {
      document.getElementById('dialog-modal').classList.add('hidden');
    }

    function switchTab(tab) {
      const isSites = tab === 'sites';
      document.getElementById('view-sites').classList.toggle('hidden', !isSites);
      document.getElementById('view-profile').classList.toggle('hidden', isSites);
      document.getElementById('nav-sites').className = `flex flex-col items-center gap-1 font-medium text-xs transition ${isSites ? 'text-accent' : 'text-muted'}`;
      document.getElementById('nav-profile').className = `flex flex-col items-center gap-1 font-medium text-xs transition ${!isSites ? 'text-accent' : 'text-muted'}`;
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.classList.remove('opacity-0');
      setTimeout(() => t.classList.add('opacity-0'), 1800);
    }

    renderCategories();
    renderSites();
    renderReleaseInfo();
    createIcons({ icons: iconSet });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') renderSites();
    });

    Object.assign(globalThis, {
      addCustomGroup, addFormNoteRow, closeDialog, closeExportModal, closeGroupModal, closeGroupPicker,
      closeSiteModal, confirmClearAllData, confirmDeleteSite, copyExportContent,
      copyProjectRepository, copySiteNote, copyText, deleteCustomGroup, exportData, handleBookmarkImport,
      handleJsonImport, openGroupModal, openGroupPicker, openSiteLink, openSiteModal, removeFormNoteRow,
      openProjectRepository, renderSites, renameCustomGroup, saveSite, setCategory, setCategoryByIndex,
      selectGroupFromPicker, switchTab, toggleDefaultMask, toggleCheckIn, toggleNoteMask, toggleSiteCredentials, updateFormNote, triggerBookmarkInput,
      clearSiteUrlError,
      triggerJsonInput
    });
