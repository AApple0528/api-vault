// Preview, share and save are deliberately separate. Never fall back from save
// to share, or from a dismissed system dialog to clipboard access.
export function createExportActions({ preview, close, notify, share, save }) {
  let currentFile;
  let busy = false;

  async function run(kind) {
    if (busy || !currentFile) return;
    busy = true;
    const file = currentFile;
    // Close before leaving the app: Android's chooser result can arrive before
    // the receiving app finishes, and cannot be used as a foreground signal.
    close();
    try {
      const result = await (kind === 'share' ? share(file) : save(file));
      if (result?.cancelled) {
        notify(kind === 'share' ? '已取消分享' : '已取消保存，未写入文件');
      } else if (kind === 'share') {
        // Neither native Share nor Web Share can confirm actual delivery.
        notify(result?.activityType
          ? '已选择分享应用，请在目标应用确认是否发送'
          : '分享面板已关闭，系统未报告是否发送');
      } else {
        notify(result?.downloadRequested ? '已请求浏览器下载，请查看下载记录' : '文件已保存');
      }
    } catch (error) {
      if (error?.name === 'AbortError' || error?.message === 'Share canceled') {
        notify(kind === 'share' ? '已取消分享' : '已取消保存');
      } else {
        notify(kind === 'share'
          ? '无法打开或完成分享，可重新导出后保存文件或复制'
          : '文件保存未完成，可重新导出后重试或复制');
      }
    } finally {
      busy = false;
    }
  }

  return {
    open(file) {
      if (busy) return;
      currentFile = { ...file };
      preview(currentFile);
    },
    share: () => run('share'),
    save: () => run('save')
  };
}

export function downloadInBrowser({ content, filename, mime }, env = globalThis) {
  const url = env.URL.createObjectURL(new env.Blob([content], { type: mime }));
  const anchor = env.document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    env.document.body.appendChild(anchor);
    anchor.click();
    return { downloadRequested: true };
  } finally {
    anchor.remove();
    env.setTimeout(() => env.URL.revokeObjectURL(url), 1500);
  }
}

export async function shareInBrowser({ content, filename, mime }, env = globalThis) {
  const file = new env.File([content], filename, { type: mime.split(';')[0] });
  if (!env.navigator.share || !env.navigator.canShare?.({ files: [file] })) {
    throw new Error('File sharing is not supported');
  }
  await env.navigator.share({ files: [file], title: filename });
}
