typedef void *napi_env;
typedef void *napi_value;
typedef napi_value (*napi_callback)(napi_env, void *);
extern int napi_create_function(napi_env, const char *, unsigned long,
                                napi_callback, void *, napi_value *);
extern int napi_set_named_property(napi_env, napi_value, const char *, napi_value);
static napi_value rea_probe(napi_env env, void *info) { return (napi_value)info; }
__attribute__((visibility("default"))) napi_value napi_register_module_v1(
    napi_env env, napi_value exports) {
  const char *names[] = {"reaProbeOne", "reaProbeTwo", "reaProbeThree"};
  for (int i = 0; i < 3; i++) {
    napi_value function = 0;
    napi_create_function(env, names[i], 0, rea_probe, 0, &function);
    napi_set_named_property(env, exports, names[i], function);
  }
  return exports;
}
