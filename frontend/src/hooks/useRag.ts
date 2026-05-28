'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { uploadFile, clearRag, UploadedFile, UploadStatus } from '@/lib/api';

export type { UploadedFile, UploadStatus };

export function useRag(sessionId: string | null, accessToken?: string) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  // Track previous sessionId to detect actual session switches (not initial mount)
  const prevSessionId = useRef(sessionId);

  useEffect(() => {
    if (prevSessionId.current !== sessionId) {
      prevSessionId.current = sessionId;
      setFiles([]);
    }
  }, [accessToken, sessionId]);

  // sid param lets the caller pass a just-created session ID before React's state updates
  const upload = useCallback(async (file: File, sid?: string) => {
    const effectiveSid = sid ?? sessionId;
    if (!effectiveSid || !accessToken) return;

    setFiles((prev) => [...prev, { fileName: file.name, chunks: 0, status: 'uploading' }]);

    try {
      const result = await uploadFile(accessToken, effectiveSid, file, (status) => {
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
  }, [accessToken, sessionId]);

  // Remove a single file from UI (embeddings remain in the backend for the session)
  const remove = useCallback((fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.fileName !== fileName));
  }, []);

  const clear = useCallback(async () => {
    if (!sessionId || !accessToken) {
      setFiles([]);
      return;
    }
    await clearRag(accessToken, sessionId);
    setFiles([]);
  }, [accessToken, sessionId]);

  const hasReadyFiles = files.some((f) => f.status === 'ready');

  return { files, upload, remove, clear, hasReadyFiles };
}
