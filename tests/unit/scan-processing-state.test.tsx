// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanProcessingState } from '../../src/web/components/scan/ScanProcessingState';

describe('ScanProcessingState', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('explains the async OCR path without claiming completion', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<ScanProcessingState stage="analyzing" kind="receipt" />);
    });
    expect(host.querySelector('[data-testid="scan-processing-state"]')).toBeTruthy();
    expect(host.textContent).toContain('Đang xử lý hóa đơn');
    expect(host.textContent).toContain('AI đang đọc nội dung');
    expect(host.textContent).toContain('kết quả chỉ hiện khi AI xử lý xong');
    expect(host.textContent).not.toContain('Đã hoàn tất');
  });

  it('announces only stage transitions while the visible elapsed timer advances', async () => {
    vi.useFakeTimers();
    await act(async () => {
      root = createRoot(host);
      root.render(<ScanProcessingState stage="queued" />);
    });
    const status = host.querySelector('[role="status"]')!;
    expect(host.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
    expect(status.textContent).toBe('Đã xếp hàng xử lý.');
    const changes = vi.fn();
    const observer = new MutationObserver(changes);
    observer.observe(status, { subtree: true, childList: true, characterData: true });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(host.textContent).toContain('Đã chờ 3 giây');
    expect(changes).not.toHaveBeenCalled();
    await act(async () => { root.render(<ScanProcessingState stage="analyzing" />); });
    expect(status.textContent).toBe('AI đang đọc nội dung.');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(status.parentElement?.closest('[aria-live], [role="status"]')).toBeNull();
    observer.disconnect();
  });
});
