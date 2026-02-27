package stacks

import (
	"iac-core/internal/config"
	iconst "iac-core/internal/constructs"
	"iac-core/internal/outputs"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awscertificatemanager"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsec2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsecs"
	"github.com/aws/aws-cdk-go/awscdk/v2/awselasticloadbalancingv2"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type EdgeStackProps struct {
	awscdk.StackProps
	Core       config.CoreConfig
	Vpc        awsec2.IVpc
	Cluster    awsecs.ICluster
	DomainName string
	AltNames   *[]*string
}

type EdgeStack struct {
	awscdk.Stack
	Alb          awselasticloadbalancingv2.ApplicationLoadBalancer
	HttpListener awselasticloadbalancingv2.ApplicationListener
}

func NewEdgeStack(scope constructs.Construct, id string, props *EdgeStackProps) *EdgeStack {
	stack := awscdk.NewStack(scope, jsii.String(id), &props.StackProps)

	albSg := awsec2.NewSecurityGroup(stack, jsii.String("AlbSg"), &awsec2.SecurityGroupProps{
		Vpc:              props.Vpc,
		AllowAllOutbound: jsii.Bool(true),
		Description:      jsii.String("ALB security group"),
	})

	alb := awselasticloadbalancingv2.NewApplicationLoadBalancer(stack, jsii.String("Alb"), &awselasticloadbalancingv2.ApplicationLoadBalancerProps{
		Vpc:            props.Vpc,
		InternetFacing: jsii.Bool(true),
		SecurityGroup:  albSg,
	})

	// Redirect HTTP to HTTPS
	httpListener := alb.AddListener(jsii.String("HttpListener"), &awselasticloadbalancingv2.BaseApplicationListenerProps{
		Port: jsii.Number(80),
		Open: jsii.Bool(true),
		DefaultAction: awselasticloadbalancingv2.ListenerAction_Redirect(&awselasticloadbalancingv2.RedirectOptions{
			Protocol:  jsii.String("HTTPS"),
			Port:      jsii.String("443"),
			Permanent: jsii.Bool(true),
		}),
	})

	cert := awscertificatemanager.NewCertificate(stack, jsii.String("AlbCertificate"), &awscertificatemanager.CertificateProps{
		DomainName:              jsii.String(props.DomainName),
		SubjectAlternativeNames: props.AltNames,
		Validation:              awscertificatemanager.CertificateValidation_FromDns(nil), // Cloudflare manual DNS record
	})

	httpsListener := alb.AddListener(jsii.String("HttpsListener"), &awselasticloadbalancingv2.BaseApplicationListenerProps{
		Port: jsii.Number(443),
		Open: jsii.Bool(true),
		Certificates: &[]awselasticloadbalancingv2.IListenerCertificate{
			awselasticloadbalancingv2.ListenerCertificate_FromArn(cert.CertificateArn()),
		},
		DefaultAction: awselasticloadbalancingv2.ListenerAction_FixedResponse(jsii.Number(404), &awselasticloadbalancingv2.FixedResponseOptions{
			ContentType: jsii.String("text/plain"),
			MessageBody: jsii.String("no route"),
		}),
	})

	// publish to SSM
	ssm := outputs.NewCoreSSM(props.Core)

	iconst.PutStringParam(stack, "SsmAlbCertArn", iconst.StringParamProps{
		Name:  ssm.AlbCertArn(),
		Value: *cert.CertificateArn(),
	})

	iconst.PutStringParam(stack, "SsmAlbHttpsListenerArn", iconst.StringParamProps{
		Name:  ssm.AlbHttpsListenerArn(),
		Value: *httpsListener.ListenerArn(),
	})

	iconst.PutStringParam(stack, "SsmAlbArn", iconst.StringParamProps{
		Name:  ssm.AlbArn(),
		Value: *alb.LoadBalancerArn(),
	})

	return &EdgeStack{
		Stack:        stack,
		Alb:          alb,
		HttpListener: httpListener,
	}
}
