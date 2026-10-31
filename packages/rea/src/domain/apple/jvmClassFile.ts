/** Maximum complete class-file buffer retained for FAT/JVM disambiguation. */
export const MAX_JVM_CLASS_IDENTITY_BYTES = 16 * 1024 * 1024;

export const JVM_CLASS_IDENTITY_LIMIT_REASON =
  "FAT/JVM identity is unresolved because the class identity scan exceeds the 16 MiB limit";

/** Class-file identity used to disambiguate JVM CAFEBABE from Mach-O FAT. */
class ClassFileCursor {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get atEnd(): boolean {
    return this.offset === this.bytes.byteLength;
  }

  u1(): number | null {
    if (!this.has(1)) return null;
    return this.bytes[this.offset++]!;
  }

  u2(): number | null {
    if (!this.has(2)) return null;
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  u4(): number | null {
    if (!this.has(4)) return null;
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  skip(length: number): boolean {
    if (!Number.isSafeInteger(length) || length < 0 || !this.has(length))
      return false;
    this.offset += length;
    return true;
  }

  private has(length: number): boolean {
    return this.offset <= this.bytes.byteLength - length;
  }
}

interface ConstantPool {
  readonly tags: (number | null)[];
  readonly first: (number | null)[];
  readonly second: (number | null)[];
}

const readConstantPool = (
  cursor: ClassFileCursor,
  count: number,
): ConstantPool | null => {
  const pool: ConstantPool = {
    tags: Array.from({ length: count }, () => null),
    first: Array.from({ length: count }, () => null),
    second: Array.from({ length: count }, () => null),
  };
  for (let index = 1; index < count; index += 1) {
    const tag = cursor.u1();
    if (tag === null) return null;
    if (!readConstant(cursor, tag, index, pool)) return null;
    if (tag === 5 || tag === 6) index += 1;
  }
  return pool;
};

const readConstant = (
  cursor: ClassFileCursor,
  tag: number,
  index: number,
  pool: ConstantPool,
): boolean => {
  switch (tag) {
    case 1: {
      const length = cursor.u2();
      if (length === null || !cursor.skip(length)) return false;
      break;
    }
    case 3:
    case 4:
      if (cursor.u4() === null) return false;
      break;
    case 5:
    case 6:
      if (index + 1 >= pool.tags.length || !cursor.skip(8)) return false;
      break;
    case 7:
    case 8:
    case 16:
    case 19:
    case 20:
      pool.first[index] = cursor.u2();
      if (pool.first[index] === null) return false;
      break;
    case 9:
    case 10:
    case 11:
    case 12:
    case 17:
    case 18:
      pool.first[index] = cursor.u2();
      pool.second[index] = cursor.u2();
      if (pool.first[index] === null || pool.second[index] === null)
        return false;
      break;
    case 15:
      pool.first[index] = cursor.u1();
      pool.second[index] = cursor.u2();
      if (pool.first[index] === null || pool.second[index] === null)
        return false;
      break;
    default:
      return false;
  }
  pool.tags[index] = tag;
  return true;
};

const poolHasTag = (
  pool: ConstantPool,
  index: number,
  ...tags: number[]
): boolean =>
  Number.isInteger(index) && index > 0 && tags.includes(pool.tags[index] ?? -1);

const hasValidPoolReferences = (pool: ConstantPool, major: number): boolean => {
  for (let index = 1; index < pool.tags.length; index += 1) {
    const tag = pool.tags[index] ?? null;
    const first = pool.first[index] ?? null;
    const second = pool.second[index] ?? null;
    if ([7, 8, 16, 19, 20].includes(tag ?? -1)) {
      if (first === null || !poolHasTag(pool, first, 1)) return false;
      if (
        (tag === 16 && major < 51) ||
        ((tag === 19 || tag === 20) && major < 53)
      )
        return false;
    } else if ([9, 10, 11].includes(tag ?? -1)) {
      if (
        first === null ||
        second === null ||
        !poolHasTag(pool, first, 7) ||
        !poolHasTag(pool, second, 12)
      )
        return false;
    } else if (tag === 12) {
      if (
        first === null ||
        second === null ||
        !poolHasTag(pool, first, 1) ||
        !poolHasTag(pool, second, 1)
      )
        return false;
    } else if (tag === 15 && !validMethodHandle(pool, first, second, major)) {
      return false;
    } else if (tag === 17 || tag === 18) {
      if (
        second === null ||
        !poolHasTag(pool, second, 12) ||
        major < (tag === 17 ? 55 : 51)
      )
        return false;
    }
  }
  return true;
};

const validMethodHandle = (
  pool: ConstantPool,
  kind: number | null,
  reference: number | null,
  major: number,
): boolean => {
  if (kind === null || reference === null || kind < 1 || kind > 9 || major < 51)
    return false;
  if (kind <= 4) return poolHasTag(pool, reference, 9);
  if (kind === 5 || kind === 8) return poolHasTag(pool, reference, 10);
  if (kind === 6 || kind === 7)
    return poolHasTag(pool, reference, ...(major >= 52 ? [10, 11] : [10]));
  return poolHasTag(pool, reference, 11);
};

const readAttributes = (
  cursor: ClassFileCursor,
  pool: ConstantPool,
  count: number,
): boolean => {
  for (let index = 0; index < count; index += 1) {
    const name = cursor.u2();
    const length = cursor.u4();
    if (
      name === null ||
      !poolHasTag(pool, name, 1) ||
      length === null ||
      !cursor.skip(length)
    )
      return false;
  }
  return true;
};

const readMembers = (cursor: ClassFileCursor, pool: ConstantPool): boolean => {
  const count = cursor.u2();
  if (count === null) return false;
  for (let index = 0; index < count; index += 1) {
    if (cursor.u2() === null) return false;
    const name = cursor.u2();
    const descriptor = cursor.u2();
    const attributes = cursor.u2();
    if (
      name === null ||
      descriptor === null ||
      !poolHasTag(pool, name, 1) ||
      !poolHasTag(pool, descriptor, 1) ||
      attributes === null ||
      !readAttributes(cursor, pool, attributes)
    )
      return false;
  }
  return true;
};

/** Validate class-file framing and constant-pool references before FAT parsing. */
export const isJvmClassFile = (bytes: Uint8Array): boolean => {
  const cursor = new ClassFileCursor(bytes);
  if (cursor.u4() !== 0xcafebabe) return false;
  const minor = cursor.u2();
  const major = cursor.u2();
  const poolCount = cursor.u2();
  if (
    minor === null ||
    major === null ||
    major < 45 ||
    poolCount === null ||
    poolCount === 0
  )
    return false;
  const pool = readConstantPool(cursor, poolCount);
  if (pool === null || !hasValidPoolReferences(pool, major)) return false;
  if (cursor.u2() === null) return false;
  const thisClass = cursor.u2();
  const superClass = cursor.u2();
  if (
    thisClass === null ||
    !poolHasTag(pool, thisClass, 7) ||
    superClass === null ||
    (superClass !== 0 && !poolHasTag(pool, superClass, 7))
  )
    return false;
  const interfaces = cursor.u2();
  if (interfaces === null) return false;
  // JVMS 4.1: every interface index must name CONSTANT_Class_info, just
  // like this_class and nonzero super_class. Framing alone is insufficient
  // to establish JVM identity when the same magic also identifies FAT.
  for (let index = 0; index < interfaces; index += 1) {
    const reference = cursor.u2();
    if (reference === null || !poolHasTag(pool, reference, 7)) return false;
  }
  if (!readMembers(cursor, pool) || !readMembers(cursor, pool)) return false;
  const attributes = cursor.u2();
  return (
    attributes !== null &&
    readAttributes(cursor, pool, attributes) &&
    cursor.atEnd
  );
};
