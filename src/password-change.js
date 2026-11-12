/** Signed-in password change. Same minimum as registration and the reset link. */
export const PASSWORD_MIN_LENGTH = 6;

export const PASSWORD_NEED_CURRENT = '請填寫現時密碼';
export const PASSWORD_NEED_NEW = '請填寫新密碼';
export const PASSWORD_NEED_CONFIRM = '請確認新密碼';
export const PASSWORD_TOO_SHORT = `密碼至少 ${PASSWORD_MIN_LENGTH} 位`;
export const PASSWORD_MISMATCH = '兩次密碼不一致';
export const PASSWORD_SAME = '新密碼不可與現時密碼相同';
export const PASSWORD_WRONG_CURRENT = '現時密碼不正確';
export const PASSWORD_UPDATED = '密碼已更新';

function asPassword(value) {
  return typeof value === 'string' ? value : '';
}

/** Field messages for the edit-profile password form. Empty string means that field is acceptable. */
export function passwordChangeErrors(currentPassword, newPassword, confirmPassword) {
  const current = asPassword(currentPassword);
  const next = asPassword(newPassword);
  const confirm = asPassword(confirmPassword);

  let newError = '';
  if (!next) newError = PASSWORD_NEED_NEW;
  else if (next.length < PASSWORD_MIN_LENGTH) newError = PASSWORD_TOO_SHORT;
  else if (current && next === current) newError = PASSWORD_SAME;

  let confirmError = '';
  if (!confirm) confirmError = PASSWORD_NEED_CONFIRM;
  else if (next && next !== confirm) confirmError = PASSWORD_MISMATCH;

  return {
    currentPassword: current ? '' : PASSWORD_NEED_CURRENT,
    newPassword: newError,
    confirmPassword: confirmError,
  };
}

export function firstPasswordChangeError(currentPassword, newPassword, confirmPassword) {
  const problems = passwordChangeErrors(currentPassword, newPassword, confirmPassword);
  return problems.currentPassword || problems.newPassword || problems.confirmPassword || '';
}

/** Which input should show a known password-change message. Empty when the message is not field-specific. */
export function passwordChangeFieldFor(message, code = '') {
  if (code === 'BAD_PASSWORD') return 'currentPassword';
  if (message === PASSWORD_NEED_CURRENT || message === PASSWORD_WRONG_CURRENT) return 'currentPassword';
  if (message === PASSWORD_NEED_NEW || message === PASSWORD_TOO_SHORT || message === PASSWORD_SAME) {
    return 'newPassword';
  }
  if (message === PASSWORD_NEED_CONFIRM || message === PASSWORD_MISMATCH) return 'confirmPassword';
  return '';
}
