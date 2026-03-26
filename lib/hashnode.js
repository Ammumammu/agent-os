// api/hashnode.js — Hashnode GraphQL Publishing
// Hashnode: free, good domain authority, ~20-200 visitors per post

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;

  try {
    switch (action) {
      case 'publishPost': return res.json(await publishPost(p));
      case 'updatePost':  return res.json(await updatePost(p));
      case 'getPost':     return res.json(await getPost(p.postId));
      case 'getStats':    return res.json(await getStats());
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function gql(query, variables = {}) {
  const r = await fetch('https://gql.hashnode.com', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.HASHNODE_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function publishPost({ title, contentMarkdown, tags = [], subtitle, coverImageUrl }) {
  const query = `
    mutation PublishPost($input: PublishPostInput!) {
      publishPost(input: $input) {
        post { id url title }
      }
    }`;

  const tagObjects = tags.map(t => ({
    slug: t.toLowerCase().replace(/\s+/g, '-'),
    name: t,
  }));

  return gql(query, {
    input: {
      title,
      contentMarkdown,
      publicationId: process.env.HASHNODE_PUBLICATION_ID,
      tags: tagObjects,
      ...(subtitle ? { subtitle } : {}),
      ...(coverImageUrl ? { coverImageOptions: { coverImageURL: coverImageUrl } } : {}),
    },
  });
}

async function updatePost({ postId, title, contentMarkdown, tags = [] }) {
  const query = `
    mutation UpdatePost($input: UpdatePostInput!) {
      updatePost(input: $input) {
        post { id url title }
      }
    }`;

  return gql(query, {
    input: {
      id: postId,
      title,
      contentMarkdown,
      tags: tags.map(t => ({ slug: t.toLowerCase().replace(/\s+/g, '-'), name: t })),
    },
  });
}

async function getPost(postId) {
  const query = `
    query GetPost($id: ID!) {
      post(id: $id) { id title url views reactionCount }
    }`;
  return gql(query, { id: postId });
}

async function getStats() {
  const query = `
    query GetStats($publicationId: ObjectId!) {
      publication(id: $publicationId) {
        postsCount
        posts(first: 50) {
          edges {
            node { id title url views reactionCount publishedAt }
          }
        }
      }
    }`;
  const data = await gql(query, { publicationId: process.env.HASHNODE_PUBLICATION_ID });
  const posts = data?.data?.publication?.posts?.edges?.map(e => e.node) || [];
  const total_views = posts.reduce((s, p) => s + (p.views || 0), 0);
  return {
    total_posts: posts.length,
    total_views,
    top_posts: [...posts].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5),
    fetched_at: new Date().toISOString(),
  };
}
