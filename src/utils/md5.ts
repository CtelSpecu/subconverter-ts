import SparkMD5 from 'spark-md5';

export function md5(str: string): string {
  return SparkMD5.hash(str);
}

export function getMD5(str: string): string {
  return md5(str);
}
