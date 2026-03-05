import { createHash } from 'crypto';
import { stringify } from 'uuid';

export function md5Uuid(data) {
  const buf = createHash("md5").update(Buffer.from(data)).digest();
  buf[6] = buf[6] & 0x0f | 0x40;
  buf[8] = buf[8] & 0xbf | 0x80;
  return stringify(buf);
}
