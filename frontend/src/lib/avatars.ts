const avatarByName: Record<string, string> = {
  张伟: '/assets/avatars/avatar-zhang-wei.png',
  张工: '/assets/avatars/avatar-zhang-wei.png',
  李娜: '/assets/avatars/avatar-li-na.png',
  李工: '/assets/avatars/avatar-operator.png',
  王强: '/assets/avatars/avatar-wang-qiang.png',
  陈晨: '/assets/avatars/avatar-chen-chen.png',
  刘洋: '/assets/avatars/avatar-liu-yang.png',
  研究者: '/assets/avatars/avatar-chen-chen.png',
  审计员: '/assets/avatars/avatar-liu-yang.png',
  受邀用户: '/assets/avatars/avatar-operator.png',
};

export function getAvatar(name: string) {
  return avatarByName[name] ?? '/assets/avatars/avatar-operator.png';
}
