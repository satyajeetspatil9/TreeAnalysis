export const TREE_PHOTOS_BUCKET = 'tree-photos';

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

export async function uploadTreePhotoFile(supabase, treeId, file) {
  if (!treeId) throw new Error('Tree not found.');
  if (!file) throw new Error('Choose a photo file first.');

  const extension = file.name.includes('.')
    ? file.name.split('.').pop().toLowerCase()
    : 'jpg';
  const path = `${treeId}/${Date.now()}-${sanitizeFileName(file.name.replace(/\.[^.]+$/, ''))}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(TREE_PHOTOS_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: inferImageContentType(file),
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
