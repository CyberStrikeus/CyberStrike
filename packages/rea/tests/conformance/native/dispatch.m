#import <Foundation/Foundation.h>

@protocol ReaDispatchProtocol
@property(nonatomic, copy) NSString *fixtureName;
- (void)performAction:(id)sender;
@optional
- (int)optionalFixtureValue;
@end

@interface ReaDispatchFixture : NSObject <ReaDispatchProtocol> {
  int state;
}
@property(nonatomic, copy) NSString *fixtureName;
@property NSInteger atomicValue;
- (void)performAction:(id)sender;
+ (int)fixtureVersion;
@end
@implementation ReaDispatchFixture
- (void)performAction:(id)sender { state += sender == nil ? 1 : 2; }
+ (int)fixtureVersion { return 1; }
@end

@interface NSString (ReaDispatchAdditions)
- (NSUInteger)reaFixtureLength;
@end
@implementation NSString (ReaDispatchAdditions)
- (NSUInteger)reaFixtureLength { return self.length; }
@end
int main(void) { return 0; }
