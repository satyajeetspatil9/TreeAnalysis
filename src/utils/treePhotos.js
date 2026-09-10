export const TREE_PHOTOS_BUCKET = 'tree-photos';
export const TREE_PHOTO_TYPE_FULL = 'TREE';
export const MAX_PHOTO_BYTES = 200 * 1024;

export function photosRlsHint(message) {
  if (!message) return message;

  const lower = message.toLowerCase();
  const migrationHint =
    'Open Settings → Save Farm to link the farm to your account, then run '
    + 'supabase/migrations/030_fix_photos_storage_rls.sql in Supabase SQL Editor.';

  if (lower.includes('row-level security') || lower.includes('rls')) {
    if (message.includes('Photo upload failed')) {
      return `${message} ${migrationHint} If SQL fails with "must be owner of table objects", add storage policies in Dashboard → Storage → tree-photos → Policies instead.`;
    }
    return `${message} ${migrationHint}`;
  }

  if (message.includes('Bucket not found') || message.includes('tree-photos')) {
    return `${message} Run supabase/migrations/030_fix_photos_storage_rls.sql in Supabase SQL Editor.`;
  }

  return message;
}

function sanitizeFileName(name) {
  return String(name || 'photo')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'photo';
}

function inferImageContentType(file) {
  if (file?.type?.startsWith('image/')) return file.type;
  const extension = file?.name?.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'heic' || extension === 'heif') return 'image/heic';
  return 'image/jpeg';
}

function jpegFileName(name) {
  const base = sanitizeFileName(String(name || 'photo').replace(/\.[^.]+$/, ''));
  return `${base || 'photo'}.jpg`;
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not compress photo.'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

async function loadImageForCompress(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // Fall through to HTMLImageElement.
      }
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this photo. Try a JPEG from the camera.'));
    };
    image.src = url;
  });
}

/** Resize and JPEG-compress until the file is under 200 KB. */
export async function compressPhotoUnderMaxBytes(file, maxBytes = MAX_PHOTO_BYTES) {
  if (!file) throw new Error('Choose a photo file first.');
  if (file.size <= maxBytes && (file.type === 'image/jpeg' || file.type === 'image/jpg')) {
    return file;
  }

  let source;
  try {
    source = await loadImageForCompress(file);
  } catch {
    throw new Error('Could not compress this photo. Try a JPEG from the camera.');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not compress photo.');

  let width = source.width || source.naturalWidth;
  let height = source.height || source.naturalHeight;
  if (!width || !height) throw new Error('Could not compress photo.');

  const maxEdge = 1280;
  if (Math.max(width, height) > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  let quality = 0.72;
  let blob = null;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    blob = await canvasToJpegBlob(canvas, quality);
    if (blob.size <= maxBytes) break;
    if (quality > 0.42) {
      quality = Math.max(0.42, quality - 0.1);
    } else {
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
      quality = 0.62;
    }
  }

  if (source.close) source.close();
  if (!blob || blob.size > maxBytes) {
    throw new Error('Photo is still over 200 KB after compression. Try a simpler shot.');
  }

  return new File([blob], jpegFileName(file.name), { type: 'image/jpeg' });
}

export function plantingDateToTakenAt(plantingDate) {
  return new Date(plantingDate).toISOString();
}

export async function fileToBase64(file) {
  const compressed = await compressPhotoUnderMaxBytes(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read photo file.'));
    reader.readAsDataURL(compressed);
  });
}

export async function saveTreePhotoFromFile(supabase, treeId, file, plantingDate) {
  const photoUrl = await uploadTreePhotoFile(supabase, treeId, file);
  await insertTreePhoto(supabase, treeId, {
    photo_url: photoUrl,
    photo_type: TREE_PHOTO_TYPE_FULL,
    description: null,
    taken_at: plantingDateToTakenAt(plantingDate),
  });
}

export async function uploadTreePhotoFile(supabase, treeId, file) {
  if (!treeId) throw new Error('Tree not found.');
  if (!file) throw new Error('Choose a photo file first.');

  const compressed = await compressPhotoUnderMaxBytes(file);
  const path = `${treeId}/${Date.now()}-${sanitizeFileName(compressed.name.replace(/\.[^.]+$/, ''))}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(TREE_PHOTOS_BUCKET)
    .upload(path, compressed, {
      cacheControl: '3600',
      upsert: false,
      contentType: inferImageContentType(compressed),
    });

  if (uploadError) {
    const detail = uploadError.message || 'Storage upload failed.';
    throw new Error(`Photo upload failed: ${detail}`);
  }

  const { data } = supabase.storage.from(TREE_PHOTOS_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Upload succeeded but public URL was not returned.');
  return data.publicUrl;
}

export async function insertTreePhoto(supabase, treeId, payload) {
  const { error } = await supabase.from('photos').insert([{
    tree_id: treeId,
    photo_url: payload.photo_url,
    photo_type: payload.photo_type,
    description: payload.description?.trim() || null,
    taken_at: payload.taken_at,
  }]);

  if (error) {
    const detail = error.message || 'Could not save photo record.';
    throw new Error(`Photo save failed: ${detail}`);
  }
}

export async function deleteTreePhoto(supabase, photo) {
  const { error } = await supabase.from('photos').delete().eq('id', photo.id);
  if (error) throw error;

  if (photo.photo_url?.includes(`/storage/v1/object/public/${TREE_PHOTOS_BUCKET}/`)) {
    const marker = `/storage/v1/object/public/${TREE_PHOTOS_BUCKET}/`;
    const storagePath = photo.photo_url.split(marker)[1];
    if (storagePath) {
      await supabase.storage.from(TREE_PHOTOS_BUCKET).remove([decodeURIComponent(storagePath)]);
    }
  }
}
