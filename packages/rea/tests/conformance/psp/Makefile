TARGET = rea_psp_fixture
OBJS = main.o probe.o
BUILD_PRX = 0
REA_PSP_GLOBAL ?= 7
CFLAGS = -O0 -g -G0 -fno-inline -fno-builtin -DREA_PSP_GLOBAL=$(REA_PSP_GLOBAL)
ASFLAGS = -g
PSPSDK := $(shell psp-config --pspsdk-path)
include $(PSPSDK)/lib/build.mak
