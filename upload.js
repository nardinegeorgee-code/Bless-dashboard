import { handleUpload } from '@vercel/blob/client';
import { route, allow, HttpError, getUser } from './_lib.js';

const ALLOWED = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'application/pdf',
  'text/plain', 'text/csv', 'text/markdown', 'application/json',
];

// Files go straight from the browser to Vercel Blob (so they are not limited by the
// 4.5 MB request cap on serverless functions). This route only issues the upload
// token, and only to signed-in people.
export default route(async (req, res) => {
  allow(req, ['POST']);
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new HttpError(500, 'File storage is not connected. In Vercel, open Storage, create a Blob store and connect it to this project, then redeploy.');
  }
  const json = await handleUpload({
    body: req.body,
    request: req,
    onBeforeGenerateToken: async () => {
      const me = await getUser(req);
      if (!me) throw new HttpError(401, 'Please sign in again.');
      return { allowedContentTypes: ALLOWED, maximumSizeInBytes: 20 * 1024 * 1024, addRandomSuffix: true };
    },
    onUploadCompleted: async () => {},
  });
  res.json(json);
});
