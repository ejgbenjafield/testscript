import { useRef, useState } from 'react';
import { formatBytes, type Attachment, type AttachmentEntityType } from '@testscript/shared';
import { ACCEPT, uploadFile } from '../lib/upload';
import { errorMessage } from '../lib/api';
import { Spinner, toast } from './ui';

/** Thumbnails and links for attached files, with an optional upload area. */
export function Files({
  entityType,
  entityId,
  files,
  canUpload,
  canDelete,
  onUploaded,
  onDelete,
  compact = false,
}: {
  entityType: AttachmentEntityType;
  entityId: string;
  files: Attachment[];
  canUpload: boolean;
  canDelete: (file: Attachment) => boolean;
  onUploaded: (file: Attachment) => void;
  onDelete: (file: Attachment) => Promise<unknown>;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  const handle = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      setUploading((n) => n + 1);
      try {
        onUploaded(await uploadFile(entityType, entityId, file));
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  if (!canUpload && files.length === 0) return null;

  return (
    <div
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDragging(false);
        void handle(e.dataTransfer.files);
      }}
      className={`flex flex-wrap items-start gap-2 rounded-md ${dragging ? 'bg-cobalt-50 outline outline-2 outline-dashed outline-cobalt-500' : ''}`}
    >
      {files.map((f) => (
        <FileThumb key={f.id} file={f} canDelete={canDelete(f)} onDelete={() => onDelete(f)} />
      ))}
      {canUpload && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={`grid place-items-center rounded-md border border-dashed border-line-strong text-xs text-ink-muted hover:border-cobalt-500 hover:text-cobalt-600 ${
              compact ? 'h-10 px-3' : 'h-16 w-28 px-2 text-center'
            }`}
          >
            {uploading > 0 ? <Spinner className="h-4 w-4" /> : compact ? 'Attach file' : 'Add screenshot or file'}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              void handle(e.target.files);
              e.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

function FileThumb({ file, canDelete, onDelete }: { file: Attachment; canDelete: boolean; onDelete: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType === 'video/mp4';
  return (
    <figure className="group relative">
      <a href={file.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-line bg-canvas" title={`${file.filename}, ${formatBytes(file.sizeBytes)}`}>
        {isImage ? (
          <img src={file.url} alt={file.filename} className="h-16 w-24 object-cover" loading="lazy" />
        ) : isVideo ? (
          <video src={file.url} className="h-16 w-24 object-cover" muted preload="metadata" />
        ) : (
          <span className="grid h-16 w-24 place-items-center px-1 text-center text-xs text-ink-soft">
            PDF
            <span className="block w-full truncate text-ink-faint">{file.filename}</span>
          </span>
        )}
      </a>
      {canDelete && (
        <button
          type="button"
          aria-label={`Remove ${file.filename}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDelete();
            } catch (err) {
              toast.error(errorMessage(err));
              setBusy(false);
            }
          }}
          className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 place-items-center rounded-full bg-ink text-xs text-white group-focus-within:grid group-hover:grid"
        >
          ×
        </button>
      )}
    </figure>
  );
}
