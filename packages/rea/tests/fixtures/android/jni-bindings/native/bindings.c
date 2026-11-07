#include <jni.h>
#include "fixture_jni_Bindings.h"
#include "fixture_jni_原名𐐀.h"

JNIEXPORT jint JNICALL Java_fixture_jni_Bindings_plain_1export(JNIEnv *env, jclass cls) {
  (void)env; (void)cls;
  return 11;
}

JNIEXPORT jint JNICALL Java_fixture_jni_Bindings_over_1load__I(JNIEnv *env, jclass cls, jint value) {
  (void)env; (void)cls;
  return value + 12;
}

JNIEXPORT jint JNICALL Java_fixture_jni_Bindings_over_1load___3Ljava_lang_String_2(JNIEnv *env, jclass cls, jobjectArray values) {
  (void)env; (void)cls; (void)values;
  return 13;
}

JNIEXPORT jint JNICALL Java_fixture_jni_Bindings__065b9_06cd5_0d801_0dc00(JNIEnv *env, jclass cls, jintArray values) {
  (void)env; (void)cls; (void)values;
  return 14;
}

JNIEXPORT jint JNICALL Java_fixture_jni__0539f_0540d_0d801_0dc00__05165_053e3_1_065b9_06cd5(JNIEnv *env, jclass cls) {
  (void)env; (void)cls;
  return 15;
}

JNIEXPORT jint JNICALL Java_fixture_jni_Bindings_sharedExport(JNIEnv *env, jclass cls) {
  (void)env; (void)cls;
  return 16;
}

static jint data_impl(JNIEnv *env, jclass cls, jint value) {
  (void)env; (void)cls;
  return value + 21;
}

static jlong relro_impl(JNIEnv *env, jclass cls, jbyteArray values) {
  (void)env; (void)cls; (void)values;
  return 22;
}

static jint unicode_impl(JNIEnv *env, jclass cls, jstring value) {
  (void)env; (void)cls; (void)value;
  return 23;
}

static jint ambiguous_impl(JNIEnv *env, jclass cls, jint value) {
  (void)env; (void)cls;
  return value + 24;
}

/* Explicit Modified UTF-8: U+10400 is encoded as UTF-16 D801 DC00, not UTF-8's
 * four-byte scalar encoding. The bytes are independently checked by oracle.py. */
static JNINativeMethod data_methods[] __attribute__((used, section(".data"))) = {
  {"registeredData", "(I)I", (void *)data_impl},
  {"ambiguous", "(I)I", (void *)ambiguous_impl},
  {"registered_\xe8\xa1\xa8\xed\xa0\x81\xed\xb0\x80", "(Ljava/lang/String;)I", (void *)unicode_impl},
};

static const JNINativeMethod relro_methods[] __attribute__((used, section(".data.rel.ro"))) = {
  {"registeredRelro", "([B)J", (void *)relro_impl},
};

/* This is genuine JNI registration code, never invoked by verification. The
 * FindClass string is not a proof of runtime attribution for a table scanner. */
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
  (void)reserved;
  JNIEnv *env = 0;
  if ((*vm)->GetEnv(vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
  jclass cls = (*env)->FindClass(env, "fixture/jni/Bindings");
  if (cls == 0) return JNI_ERR;
  if ((*env)->RegisterNatives(env, cls, data_methods, 3) != JNI_OK) return JNI_ERR;
  if ((*env)->RegisterNatives(env, cls, relro_methods, 1) != JNI_OK) return JNI_ERR;
  return JNI_VERSION_1_6;
}
