import os, re
H = os.path.dirname(os.path.abspath(__file__))
html=open(os.path.join(H,'app.html')).read()
core=open(os.path.join(H,'core.js')).read()
core=core[:core.index("if (typeof module !== 'undefined')")]
html=html.replace('/*__DB__*/',open(os.path.join(H,'db.js')).read()).replace('/*__CORE__*/',core).replace('/*__APP__*/',open(os.path.join(H,'app.js')).read())
open(os.path.join(H,'..','index.html'),'w').write(html)
print('index.html',len(html),'bytes')
