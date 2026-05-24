'use client';

import { useState, useCallback } from 'react';
import { uploadFile, clearRag, UploadedFile, UploadStatus } from '@/lib/api';

export type { UploadedFile, UploadStatus };

export function useRag(sessionId: string | null) {
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const upload = useCallback(async (file: File) => {
    if (!sessionId) return;

    setFiles((prev) => [...prev, { fileName: file.name, chunks: 0, status: 'uploading' }]);

    try {
      const result = await uploadFile(sessionId, file, (status) => {
        setFiles((prev) =>
          prev.map((f) => (f.fileName === file.name ? { ...f, status } : f))
        );
      });
      setFiles((prev) =>
        prev.map((f) => (f.fileName === file.name ? { ...f, ...result } : f))
      );
    } catch {
      setFiles((prev) =>
        prev.map((f) => (f.fileName === file.name ? { ...f, status: 'failed' as UploadStatus } : f))
      );
    }
  }, [sessionId]);

  const clear = useCallback(async () => {
    if (!sessionId) return;
    await clearRag(sessionId);
    setFiles([]);
  }, [sessionId]);

  const hasReadyFiles = files.some((f) => f.status === 'ready');

  return { files, upload, clear, hasReadyFiles };
}
