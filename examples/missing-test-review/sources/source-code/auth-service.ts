export class AuthService {
  verifyCode(code: string) {
    return code.length > 0
  }
}
