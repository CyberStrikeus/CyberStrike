#include <jni.h>
#include "fixture_jni_Bindings.h"

/* A distinct library exports the same JNI short name within each ABI. */
JNIEXPORT jint JNICALL Java_fixture_jni_Bindings_sharedExport(JNIEnv *env, jclass cls) {
  (void)env; (void)cls;
  return 31;
}
