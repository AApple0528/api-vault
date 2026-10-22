export function reorderByIndex(items, order) {
  if (!Array.isArray(items) || !Array.isArray(order) || order.length !== items.length) return items.slice();
  const unique = new Set(order);
  if (unique.size !== items.length || order.some(index => !Number.isInteger(index) || index < 0 || index >= items.length)) {
    return items.slice();
  }
  return order.map(index => items[index]);
}

export function serializeFormNotes(notes) {
  return notes
    .filter(note => note.label.trim() || note.value.trim())
    .map((note, index) => ({
      label: note.label.trim() || `便签 ${index + 1}`,
      value: note.value.trim() || '暂无内容',
      masked: Boolean(note.masked)
    }));
}

export function persistJsonArrays(storage, entries) {
  entries.forEach(([key, items]) => storage.setItem(key, JSON.stringify(items)));
}

export function bindLongPressSortable(container, {
  itemSelector = '[data-sort-index]',
  handleSelector = '[data-sort-handle]',
  scrollHostSelector = '.app-modal-panel',
  delay = 260,
  onReorder
} = {}) {
  if (!container) return () => {};

  let pending = null;
  let dragged = null;
  let placeholder = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let timer = 0;
  let clickTimer = 0;
  let initialOrder = [];
  let didDrag = false;
  let draggedStyle = null;

  const getItems = () => Array.from(container.querySelectorAll(itemSelector));

  const restoreDraggedStyle = () => {
    if (!dragged) return;
    if (draggedStyle === null) dragged.removeAttribute('style');
    else dragged.setAttribute('style', draggedStyle);
    dragged.classList.remove('is-sorting');
    draggedStyle = null;
  };

  const clearTranslations = () => {
    getItems().forEach(item => {
      item.style.removeProperty('--sort-x');
      item.style.removeProperty('--sort-y');
      item.classList.remove('is-sort-shifting');
    });
  };

  const animateLayout = before => {
    getItems().forEach(item => {
      if (item === dragged) return;
      const oldRect = before.get(item);
      if (!oldRect) return;
      const rect = item.getBoundingClientRect();
      const dx = oldRect.left - rect.left;
      const dy = oldRect.top - rect.top;
      if (!dx && !dy) return;
      item.classList.add('is-sort-shifting');
      item.style.setProperty('--sort-x', `${dx}px`);
      item.style.setProperty('--sort-y', `${dy}px`);
      requestAnimationFrame(() => {
        item.style.setProperty('--sort-x', '0px');
        item.style.setProperty('--sort-y', '0px');
      });
    });
  };

  const placeDraggedAt = (x, y) => {
    if (!dragged) return;
    dragged.style.setProperty('--sort-x', `${x - startX}px`);
    dragged.style.setProperty('--sort-y', `${y - startY}px`);
  };

  const reset = ({ restore = false } = {}) => {
    window.clearTimeout(timer);
    if (restore && dragged) {
      initialOrder.forEach(item => container.appendChild(item));
      placeholder?.remove();
    } else if (dragged && placeholder) {
      container.insertBefore(dragged, placeholder);
      placeholder.remove();
    }
    restoreDraggedStyle();
    pending?.classList.remove('is-sort-pending');
    if (container.hasPointerCapture?.(pointerId)) container.releasePointerCapture(pointerId);
    clearTranslations();
    pending = null;
    dragged = null;
    placeholder = null;
    pointerId = null;
    timer = 0;
    initialOrder = [];
  };

  const pointerUp = event => {
    if (pointerId !== event.pointerId) return;
    const completed = Boolean(dragged);
    if (completed) {
      event.preventDefault();
      const originalIndexes = new Map(initialOrder.map(item => [item, Number(item.dataset.sortIndex)]));
      const order = Array.from(container.children)
        .flatMap(item => item === placeholder ? [dragged] : item.matches?.(itemSelector) ? [item] : [])
        .map(item => originalIndexes.get(item));
      didDrag = true;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => { didDrag = false; }, 500);
      reset();
      if (order.some((index, position) => index !== position)) onReorder?.(order);
      return;
    }
    reset();
  };

  const pointerCancel = event => {
    if (pointerId !== event.pointerId) return;
    reset({ restore: Boolean(dragged) });
  };

  const pointerDown = event => {
    if (pointerId !== null) return;
    if (event.button !== undefined && event.button !== 0) return;
    const sortHandle = event.target.closest(handleSelector);
    const item = sortHandle?.closest(itemSelector);
    if (!sortHandle || !item || !container.contains(item)) return;

    pending = item;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastX = startX;
    lastY = startY;
    initialOrder = getItems();
    pending.classList.add('is-sort-pending');
    container.setPointerCapture?.(pointerId);
    timer = window.setTimeout(() => {
      if (!pending) return;
      dragged = pending;
      dragged.classList.remove('is-sort-pending');
      dragged.classList.add('is-sorting');
      const rect = dragged.getBoundingClientRect();
      draggedStyle = dragged.getAttribute('style');
      placeholder = dragged.cloneNode(false);
      placeholder.removeAttribute('data-sort-index');
      placeholder.removeAttribute('id');
      placeholder.classList.add('sortable-placeholder');
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.width = `${rect.width}px`;
      placeholder.style.height = `${rect.height}px`;
      placeholder.style.boxSizing = 'border-box';
      container.insertBefore(placeholder, dragged);
      Object.assign(dragged.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
        zIndex: '10000', pointerEvents: 'none', transition: 'none'
      });
      document.body.appendChild(dragged);
      placeDraggedAt(lastX, lastY);
      navigator.vibrate?.(20);
    }, delay);
  };

  const getAxis = () => {
    if (initialOrder.length < 2) return 'y';
    const first = initialOrder[0].getBoundingClientRect();
    const second = initialOrder[1].getBoundingClientRect();
    return Math.abs(second.left - first.left) > Math.abs(second.top - first.top) ? 'x' : 'y';
  };

  const pointerMove = event => {
    if (pointerId !== event.pointerId || !pending) return;
    if (!dragged) {
      lastX = event.clientX;
      lastY = event.clientY;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) reset();
      return;
    }

    event.preventDefault();
    lastX = event.clientX;
    lastY = event.clientY;
    placeDraggedAt(lastX, lastY);
    const scrollHost = container.closest(scrollHostSelector);
    if (scrollHost) {
      const scrollRect = scrollHost.getBoundingClientRect();
      const edge = 48;
      if (getAxis() === 'x') {
        if (event.clientX < scrollRect.left + edge) scrollHost.scrollBy({ left: -12 });
        else if (event.clientX > scrollRect.right - edge) scrollHost.scrollBy({ left: 12 });
      } else if (event.clientY < scrollRect.top + edge) scrollHost.scrollBy({ top: -12 });
      else if (event.clientY > scrollRect.bottom - edge) scrollHost.scrollBy({ top: 12 });
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(itemSelector);
    if (!target || target === dragged || !container.contains(target) || !placeholder) return;
    const before = new Map(getItems().map(item => [item, item.getBoundingClientRect()]));
    const rect = target.getBoundingClientRect();
    const insertAfter = getAxis() === 'x'
      ? event.clientX > rect.left + rect.width / 2
      : event.clientY > rect.top + rect.height / 2;
    const reference = insertAfter ? target.nextSibling : target;
    if (reference === placeholder || (insertAfter && target.nextSibling === placeholder)) return;
    container.insertBefore(placeholder, reference);
    animateLayout(before);
  };

  const suppressClick = event => {
    if (!didDrag) return;
    event.preventDefault();
    event.stopPropagation();
    didDrag = false;
    window.clearTimeout(clickTimer);
  };

  container.addEventListener('pointerdown', pointerDown);
  container.addEventListener('pointermove', pointerMove);
  container.addEventListener('pointerup', pointerUp);
  container.addEventListener('pointercancel', pointerCancel);
  container.addEventListener('click', suppressClick, true);

  const cancelOnBlur = () => reset({ restore: Boolean(dragged) });
  const lostPointerCapture = event => {
    if (pointerId === event.pointerId) reset({ restore: Boolean(dragged) });
  };
  window.addEventListener('blur', cancelOnBlur);
  container.addEventListener('lostpointercapture', lostPointerCapture);

  return () => {
    reset({ restore: Boolean(dragged) });
    container.removeEventListener('pointerdown', pointerDown);
    container.removeEventListener('pointermove', pointerMove);
    container.removeEventListener('pointerup', pointerUp);
    container.removeEventListener('pointercancel', pointerCancel);
    container.removeEventListener('click', suppressClick, true);
    window.removeEventListener('blur', cancelOnBlur);
    container.removeEventListener('lostpointercapture', lostPointerCapture);
    window.clearTimeout(clickTimer);
  };
}
