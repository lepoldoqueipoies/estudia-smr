const KEY = 'estudios_v1';

export const store = {
  data: {
    users: [{ name: 'nixan1dev', role: 'admin', createdAt: 1700000000000 }],
    session: null,
    messages: [],
    events: [],
    news: [],
    subjects: [],
    schedule: [],
    permissions: {},
    nicknames: {},
    avatars: {},
    notifs: [],
    seenNotifs: {},
    banned: [],
    iaChats: [],
    online: true,
    pwd: null,
    adminToken: null
  },

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch {}
    this.data.pwd = null;
    // cada carga de página reintenta el servidor una vez
    this.data.online = true;
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {}
  },

  user(name) {
    return this.data.users.find(u => u.name === name);
  },

  current() {
    return this.user(this.data.session);
  },

  roleOf(name) {
    const u = this.user(name);
    return u ? u.role : 'user';
  },

  nick(name) {
    return this.data.nicknames[name] || '';
  },

  avatar(name) {
    return this.data.avatars[name] || '';
  }
};
