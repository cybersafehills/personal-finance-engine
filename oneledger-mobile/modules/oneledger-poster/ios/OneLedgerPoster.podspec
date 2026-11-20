Pod::Spec.new do |s|
  s.name = 'OneLedgerPoster'
  s.version = '0.1.0'
  s.summary = 'On-device merchant poster text recognition'
  s.description = 'Reads temporary camera photos using Apple Vision.'
  s.license = { :type => 'MIT' }
  s.author = 'OneLedger'
  s.homepage = 'https://oneledger.me'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'ImageIO'
  s.source_files = '**/*.{h,m,mm,swift}'
end
