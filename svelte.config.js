import adapter from '@sveltejs/adapter-static';

const config = {
  kit: {
    adapter: adapter({
      fallback: 'index.html'
    }),
    alias: {
      $components: 'src/lib/components',
      $stores: 'src/lib/stores',
      $types: 'src/lib/types',
      $utils: 'src/lib/utils'
    }
  }
};

export default config;
