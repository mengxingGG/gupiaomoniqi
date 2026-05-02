import fs from 'fs';
import path from 'path';

const surnames = ['李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧', '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕', '苏', '卢', '蒋', '蔡', '贾', '丁', '魏', '薛', '叶', '阎', '潘', '杜', '戴', '夏', '钟', '汪', '田', '任', '姜', '范', '方'];

const givenNames = ['伟', '军', '洋', '勇', '毅', '俊', '峰', '强', '宇', '明', '超', '杰', '涛', '飞', '亮', '刚', '磊', '浩', '华', '斌', '凯', '鹏', '博', '东', '旭', '宁', '健', '晨', '鑫', '辉', '龙', '锋', '诚', '阳', '志', '平', '波', '静', '宏', '雷', '勇', '军', '杰', '涛', '峰', '阳', '明', '浩', '伟', '建', '国', '庆', '民', '春', '秋', '冬', '夏', '光', '荣', '华', '志', '强', '兵', '发'];

function generateUniqueNames(count: number): string[] {
  const names = new Set<string>();
  while (names.size < count) {
    const surname = surnames[Math.floor(Math.random() * surnames.length)];
    const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];
    names.add(`${surname}${givenName}`);
  }
  return Array.from(names);
}

const names = [];
let total = 0;
while (total < 5000) {
  const batchSize = Math.min(100, 5000 - total);
  const batch = generateUniqueNames(batchSize);
  names.push(...batch);
  total += batchSize;
  console.log(`Generated ${total}/5000`);
  if (total < 5000) {
    // Busy sleep 10s (CPU low since short batches)
    const start = Date.now();
    while (Date.now() - start < 10000) {
      // Low CPU loop
    }
  }
}

const data = names.map(name => ({ name }));
const outputPath = path.join(process.cwd(), 'data', 'ai_names.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');

console.log(`✅ 5000 AI names saved to ${outputPath}`);
console.log('Sample:', data.slice(0, 10).map(n => n.name).join(', '));
